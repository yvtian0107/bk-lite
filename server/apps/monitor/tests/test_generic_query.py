"""监控通用查询的上限、缺测和告警时间范围。"""

from datetime import datetime, timedelta, timezone

import pytest

from apps.monitor.models.monitor_object import MonitorInstance, MonitorObject
from apps.monitor.models.monitor_policy import MonitorAlert
from apps.monitor.services.generic_query import GenericQueryError, build_metric_result, query_alerts, query_instances, validate_metric_request
from apps.monitor.services.generic_query_limits import (
    ALERT_RANGE_MAX_SECONDS,
    DETAIL_PAGE_SIZE_MAX,
    METRIC_INSTANCE_MAX,
    METRIC_POINTS_MAX,
    METRIC_SERIES_MAX,
)

pytestmark = pytest.mark.django_db


def _object():
    return MonitorObject.objects.create(name="host-object", level="base")


def _instance(obj, instance_id, *, active=True, cmdb_id="", name=""):
    return MonitorInstance.objects.create(
        id=instance_id,
        name=name or instance_id,
        monitor_object=obj,
        is_active=active,
        cmdb_id=cmdb_id or None,
        ip="10.0.0.8",
    )


def test_monitor_instance_detail_count_and_unbound_identity():
    obj = _object()
    _instance(obj, "host-1", cmdb_id="cmdb-1")
    _instance(obj, "host-2", active=False)

    detail = query_instances(MonitorInstance.objects.filter(monitor_object=obj), analysis_mode="detail", order="id")
    counted = query_instances(
        MonitorInstance.objects.filter(monitor_object=obj),
        analysis_mode="count",
        status="inactive",
    )
    grouped = query_instances(MonitorInstance.objects.filter(monitor_object=obj), analysis_mode="distribution", group_by="status")

    assert detail["count"] == 2
    assert detail["page"] == 1
    assert detail["page_size"] == 20
    unbound = next(item for item in detail["items"] if item["instance_id"] == "host-2")
    assert unbound["cmdb_bind_status"] == "unbound"
    assert counted["value"] == 1
    assert counted["status"] == "ok"
    assert {item["name"] for item in grouped["items"]} == {"active", "inactive"}


def test_instance_or_group_matches_either_row_and_empty_group_does_not_filter():
    obj = _object()
    _instance(obj, "host-1", name="alpha")
    other = _instance(obj, "host-2", name="beta")
    other.ip = "10.9.9.9"
    other.save(update_fields=["ip"])
    base = MonitorInstance.objects.filter(monitor_object=obj)
    either = query_instances(
        base,
        analysis_mode="count",
        filters={
            "logic": "OR",
            "items": [
                {"field": "name", "op": "eq", "value": "alpha"},
                {"field": "ip", "op": "eq", "value": "10.9.9.9"},
            ],
        },
    )
    both = query_instances(
        base,
        analysis_mode="count",
        filters={
            "logic": "AND",
            "items": [
                {"field": "name", "op": "eq", "value": "alpha"},
                {"field": "ip", "op": "eq", "value": "10.9.9.9"},
            ],
        },
    )
    cleared = query_instances(base, analysis_mode="count", filters={"logic": "OR", "items": []})
    assert either["value"] == 2
    assert both["value"] == 0
    assert cleared["value"] == 2


def test_monitor_instance_page_size_and_statistics_group_limits():
    obj = _object()
    _instance(obj, "host-1")
    with pytest.raises(GenericQueryError, match=str(DETAIL_PAGE_SIZE_MAX)):
        query_instances(
            MonitorInstance.objects.all(),
            analysis_mode="detail",
            page_size=DETAIL_PAGE_SIZE_MAX + 1,
        )
    with pytest.raises(GenericQueryError, match="不支持分页"):
        query_instances(MonitorInstance.objects.all(), analysis_mode="count", page_size=10)


def test_metric_point_and_instance_limits_fail_before_query():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    step_seconds = 60
    too_long = start + timedelta(seconds=step_seconds * (METRIC_POINTS_MAX + 1))
    with pytest.raises(GenericQueryError, match="两端"):
        validate_metric_request(
            instance_ids=["host-1"],
            time_range=[start.isoformat(), too_long.isoformat()],
            step="60s",
        )
    exact = validate_metric_request(
        instance_ids=["host-1"],
        time_range=[start.isoformat(), (start + timedelta(seconds=step_seconds * METRIC_POINTS_MAX)).isoformat()],
        step="60s",
    )
    assert exact["points"] == METRIC_POINTS_MAX
    with pytest.raises(GenericQueryError, match=str(METRIC_INSTANCE_MAX)):
        validate_metric_request(
            instance_ids=[f"host-{index}" for index in range(METRIC_INSTANCE_MAX + 1)],
            time_range=[start.isoformat(), (start + timedelta(minutes=5)).isoformat()],
            step="60s",
        )
    with pytest.raises(GenericQueryError, match="实例范围不能为空"):
        validate_metric_request(instance_ids=[], time_range=[start.isoformat(), (start + timedelta(minutes=5)).isoformat()], step="60s")


def test_metric_series_over_limit_missing_and_zero_are_distinct():
    overflow = {"status": "success", "data": {"result": [{"metric": {}, "values": [[1, "1"]]} for _ in range(METRIC_SERIES_MAX + 1)]}}
    with pytest.raises(GenericQueryError, match=str(METRIC_SERIES_MAX)):
        build_metric_result(mode="series", response=overflow, unit="%", aggregation="avg", requested_ids=["a"])

    missing = build_metric_result(
        mode="value",
        response={"status": "success", "data": {"result": []}},
        unit="%",
        aggregation="avg",
        requested_ids=["a"],
    )
    zero = build_metric_result(
        mode="value",
        response={"status": "success", "data": {"result": [{"metric": {"instance_id": "a"}, "values": [[1, "0"]]}]}},
        unit="%",
        aggregation="avg",
        requested_ids=["a"],
    )
    assert missing["status"] == "missing"
    assert missing["value"] is None
    assert zero["status"] == "ok"
    assert zero["value"] == 0
    assert zero["unit"] == "%"

    partial = build_metric_result(
        mode="series",
        response={
            "status": "success",
            "data": {"result": [{"metric": {"instance_id": "a"}, "values": [[1, "1"], [2, "NaN"], [3, "0"]]}]},
        },
        unit="%",
        aggregation="avg",
        requested_ids=["a", "b"],
    )
    assert partial["structure"] == "series"
    assert partial["status"] == "ok"
    assert [point["value"] for point in partial["series"]["a"]] == [1.0, None, 0.0]
    assert partial["unbound_instance_ids"] == ["b"]
    missing_series = build_metric_result(
        mode="series",
        response={"status": "success", "data": {"result": []}},
        unit="%",
        aggregation="avg",
        requested_ids=["a"],
    )
    assert missing_series["structure"] == "series"
    assert missing_series["status"] == "missing"
    assert missing_series["series"] == {}


def test_metric_handler_rejects_non_list_filters():
    from apps.monitor.nats.generic_query import query_monitor_instances, query_monitor_metric

    instances = query_monitor_instances(monitor_object_id="1", filters={"label": "cpu"})
    assert instances["result"] is False
    assert "条件过滤" in instances["message"]
    metric = query_monitor_metric(
        metric_id="cpu",
        instance_ids=["host-1"],
        time_range=["2026-01-01T00:00:00+00:00", "2026-01-01T01:00:00+00:00"],
        step="60s",
        filters={"label": "cpu"},
    )
    assert metric["result"] is False
    assert "filters" in metric["message"]


def test_monitor_alert_range_is_capped_at_90_days_and_failure_is_explicit():
    obj = _object()
    instance = _instance(obj, "host-1")
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    MonitorAlert.objects.create(
        monitor_instance_id=instance.id,
        monitor_instance_name=instance.name,
        level="warning",
        status="new",
        alert_type="alert",
        start_event_time=start + timedelta(days=1),
    )
    within = query_alerts(
        MonitorAlert.objects.all(),
        analysis_mode="count",
        time_field="start_event_time",
        time_range=[start.isoformat(), (start + timedelta(seconds=ALERT_RANGE_MAX_SECONDS)).isoformat()],
    )
    assert within["value"] == 1
    with pytest.raises(GenericQueryError, match="90"):
        query_alerts(
            MonitorAlert.objects.all(),
            analysis_mode="count",
            time_field="start_event_time",
            time_range=[start.isoformat(), (start + timedelta(seconds=ALERT_RANGE_MAX_SECONDS + 1)).isoformat()],
        )
    with pytest.raises(GenericQueryError, match="时间字段"):
        query_alerts(
            MonitorAlert.objects.all(),
            analysis_mode="detail",
            time_field="not_a_field",
            time_range=[start.isoformat(), (start + timedelta(days=1)).isoformat()],
        )
