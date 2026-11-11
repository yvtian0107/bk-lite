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
    assert alerts["page"] == 1
    assert alerts["page_size"] == 20
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


def test_alert_source_filter_does_not_multiply_distribution_count():
    source = _source()
    other = AlertSource.objects.create(name="other", source_id="src-2", source_type=AlertsSourceTypes.WEBHOOK)
    alert = _alert("ALERT-1", created_at=START + timedelta(hours=1))
    first = _event("EVENT-1", source)
    second = _event("EVENT-2", source)
    outsider = _event("EVENT-3", other)
    alert.events.add(first, second, outsider)
    _alert("ALERT-2", level="fatal", created_at=START + timedelta(hours=2))
    day = _range(24 * 60 * 60)

    counted = query_alert_center(
        Alert.objects.all(),
        query_object="alert",
        analysis_mode="count",
        source="src-1",
        time_field="created_at",
        time_range=day,
    )
    grouped = query_alert_center(
        Alert.objects.all(),
        query_object="alert",
        analysis_mode="distribution",
        source="src-1",
        time_field="created_at",
        time_range=day,
        group_by="level",
    )

    assert counted["value"] == 1
    assert grouped["items"] == [{"name": "warning", "value": 1}]


def test_status_options_follow_query_object():
    _alert("ALERT-1", created_at=START + timedelta(hours=1))
    day = _range(24 * 60 * 60)
    with pytest.raises(GenericQueryError, match="状态不受支持"):
        query_alert_center(
            Alert.objects.all(),
            query_object="alert",
            analysis_mode="count",
            status="received",
            time_field="created_at",
            time_range=day,
        )
    with pytest.raises(GenericQueryError, match="状态不受支持"):
        query_alert_center(
            Event.objects.all(),
            query_object="event",
            analysis_mode="count",
            status="unassigned",
            time_field="start_time",
            time_range=day,
        )


def test_event_queryset_follows_event_rules_and_is_empty_without_rules(monkeypatch):
    from apps.alerts.nats.generic_query import query_alert_center as handler

    source = _source()
    own = _event("EVENT-OWN", source)
    Event.objects.create(
        source=source,
        raw_data={},
        title="other-org",
        description="",
        level="warning",
        start_time=START + timedelta(hours=1),
        event_id="EVENT-OTHER",
        team=[2],
    )
    rules = {"team": [], "instance": []}

    def fake_rules(user, current_team, app_name, permission_key, include_children=False):
        assert app_name == "alerts"
        assert permission_key == "event"
        assert current_team == 1
        return rules

    monkeypatch.setattr("apps.alerts.nats.generic_query.get_permission_rules", fake_rules)
    user_info = {
        "user": "alice",
        "domain": "example.com",
        "team": 1,
        "permission": {"alarm": ["Integration-View"]},
    }
    day = _range(24 * 60 * 60)

    empty = handler(
        query_object="event",
        analysis_mode="count",
        time_field="start_time",
        time_range=day,
        user_info=user_info,
    )
    assert empty["result"] is True
    assert empty["data"]["value"] == 0

    rules = {"team": [1], "instance": []}
    scoped = handler(
        query_object="event",
        analysis_mode="detail",
        time_field="start_time",
        time_range=day,
        user_info=user_info,
    )
    assert [item["event_id"] for item in scoped["data"]["items"]] == ["EVENT-OWN"]

    rules = {"team": [], "instance": [{"id": own.id}]}
    by_instance = handler(
        query_object="event",
        analysis_mode="count",
        time_field="start_time",
        time_range=day,
        user_info=user_info,
    )
    assert by_instance["data"]["value"] == 1

    denied = handler(
        query_object="event",
        analysis_mode="count",
        time_field="start_time",
        time_range=day,
        user_info={**user_info, "permission": {"alarm": ["Alarms-Edit"]}},
    )
    assert denied["result"] is False
    assert denied["message"] == "权限不足"

    allowed = handler(
        query_object="event",
        analysis_mode="count",
        time_field="start_time",
        time_range=day,
        user_info={**user_info, "permission": {"alarm": ["Alarms-View"]}},
    )
    assert allowed["result"] is True
    assert allowed["data"]["value"] == 1


def test_alert_or_group_cannot_leave_the_authorized_queryset_or_multiply_count():
    source = _source()
    other = AlertSource.objects.create(name="other", source_id="src-2", source_type=AlertsSourceTypes.WEBHOOK)
    alert = _alert("ALERT-1", created_at=START + timedelta(hours=1))
    alert.events.add(_event("EVENT-1", source), _event("EVENT-2", source), _event("EVENT-3", other))
    _alert("ALERT-2", level="fatal", created_at=START + timedelta(hours=2))
    day = _range(24 * 60 * 60)
    filters = {
        "logic": "OR",
        "items": [
            {"field": "source", "op": "eq", "value": "src-1"},
            {"field": "level", "op": "eq", "value": "fatal"},
        ],
    }
    counted = query_alert_center(
        Alert.objects.all(),
        query_object="alert",
        analysis_mode="count",
        time_field="created_at",
        time_range=day,
        filters=filters,
    )
    grouped = query_alert_center(
        Alert.objects.all(),
        query_object="alert",
        analysis_mode="distribution",
        time_field="created_at",
        time_range=day,
        group_by="level",
        filters=filters,
    )
    scoped = query_alert_center(
        Alert.objects.filter(alert_id="ALERT-1"),
        query_object="alert",
        analysis_mode="count",
        time_field="created_at",
        time_range=day,
        filters=filters,
    )
    assert counted["value"] == 2
    assert {item["name"]: item["value"] for item in grouped["items"]} == {"warning": 1, "fatal": 1}
    assert scoped["value"] == 1


def test_handler_rejects_unsupported_filters():
    from apps.alerts.nats.generic_query import query_alert_center as handler

    result = handler(query_object="alert", analysis_mode="count", user_info={}, filters=[{"field": "level"}])
    assert result["result"] is False
    assert "条件过滤" in result["message"]


def test_handler_rejects_unknown_query_object_and_keeps_extra_kwargs():
    from apps.alerts.nats.generic_query import query_alert_center as handler

    result = handler(query_object="both", analysis_mode="detail", user_info={}, extra_param="ignored")
    assert result["result"] is False
    assert "告警或事件" in result["message"]
