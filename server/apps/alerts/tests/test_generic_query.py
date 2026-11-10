"""告警中心通用查询：告警和事件分开，时间上限和空结果。"""

from datetime import datetime, timedelta, timezone

import pytest

from apps.alerts.constants.constants import AlertsSourceTypes
from apps.alerts.models.alert_source import AlertSource
from apps.alerts.models.models import Alert, Event
from apps.alerts.services.generic_query import GenericQueryError, query_alert_center
from apps.alerts.services.generic_query_limits import DETAIL_PAGE_SIZE_MAX, RANGE_MAX_SECONDS, STAT_GROUP_MAX

pytestmark = pytest.mark.django_db

START = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _range(seconds):
    return [START.isoformat(), (START + timedelta(seconds=seconds)).isoformat()]


def _source():
    return AlertSource.objects.create(name="webhook", source_id="src-1", source_type=AlertsSourceTypes.WEBHOOK)


def _alert(alert_id, *, level="warning", created_at=None):
    alert = Alert.objects.create(
        alert_id=alert_id,
        level=level,
        title=alert_id,
        content="content",
        fingerprint=alert_id,
        team=[1],
        source_name="webhook",
    )
    if created_at:
        Alert.objects.filter(pk=alert.pk).update(created_at=created_at)
    return alert


def _event(event_id, source, *, level="warning", start_time=None):
    return Event.objects.create(
        source=source,
        raw_data={},
        title=event_id,
        description="",
        level=level,
        start_time=start_time or START + timedelta(hours=1),
        event_id=event_id,
        team=[1],
    )


def test_alert_and_event_queries_do_not_share_rows():
    source = _source()
    _alert("ALERT-1", created_at=START + timedelta(hours=2))
    _event("EVENT-1", source)
    day = _range(24 * 60 * 60)

    alerts = query_alert_center(
        Alert.objects.all(),
        query_object="alert",
        analysis_mode="detail",
        time_field="created_at",
        time_range=day,
    )
    events = query_alert_center(
        Event.objects.all(),
        query_object="event",
        analysis_mode="count",
        time_field="start_time",
        time_range=day,
    )

    assert [item["alert_id"] for item in alerts["items"]] == ["ALERT-1"]
    assert "event_id" not in alerts["items"][0]
    assert events["value"] == 1
    assert events["aggregation"].startswith("事件")


def test_alert_center_requires_time_and_rejects_ranges_over_90_days():
    _alert("ALERT-1", created_at=START + timedelta(days=1))
    with pytest.raises(GenericQueryError, match="时间范围不能为空"):
        query_alert_center(Alert.objects.all(), query_object="alert", analysis_mode="count", time_field="created_at")
    allowed = query_alert_center(
        Alert.objects.all(),
        query_object="alert",
        analysis_mode="count",
        time_field="created_at",
        time_range=_range(RANGE_MAX_SECONDS),
    )
    assert allowed["value"] == 1
    with pytest.raises(GenericQueryError, match="90"):
        query_alert_center(
            Alert.objects.all(),
            query_object="alert",
            analysis_mode="count",
            time_field="created_at",
            time_range=_range(RANGE_MAX_SECONDS + 1),
        )


def test_alert_center_page_group_and_empty_results():
    with pytest.raises(GenericQueryError, match=str(DETAIL_PAGE_SIZE_MAX)):
        query_alert_center(
            Alert.objects.all(),
            query_object="alert",
            analysis_mode="detail",
            time_field="created_at",
            time_range=_range(3600),
            page_size=DETAIL_PAGE_SIZE_MAX + 1,
        )
    with pytest.raises(GenericQueryError, match="不支持分页"):
        query_alert_center(
            Alert.objects.all(),
            query_object="alert",
            analysis_mode="count",
            time_field="created_at",
            time_range=_range(3600),
            page=1,
        )
    empty = query_alert_center(
        Alert.objects.all(),
        query_object="alert",
        analysis_mode="detail",
        time_field="created_at",
        time_range=_range(3600),
    )
    zero = query_alert_center(
        Alert.objects.all(),
        query_object="alert",
        analysis_mode="count",
        time_field="created_at",
        time_range=_range(3600),
    )
    assert empty["status"] == "empty"
    assert empty["items"] == []
    assert zero["status"] == "ok"
    assert zero["value"] == 0

    for index in range(STAT_GROUP_MAX + 1):
        _alert(f"ALERT-{index}", level=f"L{index}", created_at=START + timedelta(minutes=1))
    with pytest.raises(GenericQueryError, match=str(STAT_GROUP_MAX)):
        query_alert_center(
            Alert.objects.all(),
            query_object="alert",
            analysis_mode="distribution",
            time_field="created_at",
            time_range=_range(24 * 60 * 60),
            group_by="level",
        )


def test_handler_rejects_unknown_query_object_and_keeps_extra_kwargs():
    from apps.alerts.nats.generic_query import query_alert_center as handler

    result = handler(query_object="both", analysis_mode="detail", user_info={}, extra_param="ignored")
    assert result["result"] is False
    assert "告警或事件" in result["message"]
