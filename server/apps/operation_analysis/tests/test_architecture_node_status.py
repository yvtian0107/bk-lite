import json
import logging
from types import SimpleNamespace

import pytest
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.logger import SafeLogException
from apps.operation_analysis.services.architecture_node_status import MAX_INST_UUIDS, ArchitectureNodeStatusService
from apps.operation_analysis.views.share_view import DashboardShareAccessViewSet
from apps.operation_analysis.views.view import ArchitectureModelViewSet

SECRET = "super-secret-node-status"
USER_INFO = {"user": "alice", "team": 1, "domain": "domain.com"}


def _uuid(index: int) -> str:
    return f"00000000-0000-4000-8000-{index:012d}"


def _render(response):
    response.render()
    return json.loads(response.rendered_content)


def _patch_user(monkeypatch, user_info=None):
    monkeypatch.setattr(
        "apps.operation_analysis.services.architecture_node_status.build_nats_user_info",
        lambda request: user_info or USER_INFO,
    )


def _cmdb(monkeypatch, handler):
    class _Client:
        def get_monitor_ids_by_inst_uuids(self, **kwargs):
            return handler(**kwargs)

    monkeypatch.setattr(
        "apps.operation_analysis.services.architecture_node_status.CMDB",
        lambda: _Client(),
    )


def _monitor(monkeypatch, handler):
    class _Client:
        def __init__(self):
            self.ingest_client = self

        def run(self, name, query_data=None, user_info=None):
            assert name == "query_latest_active_alerts"
            return handler(query_data=query_data, user_info=user_info)

    monkeypatch.setattr(
        "apps.operation_analysis.services.architecture_node_status.Monitor",
        lambda: _Client(),
    )


def _mapping(inst_uuid, monitor_id="mon", model_id="host", inst_name="web-01"):
    return {
        "result": True,
        "data": {
            "items": [
                {
                    "inst_uuid": inst_uuid,
                    "model_id": model_id,
                    "monitor_id": monitor_id,
                    "inst_name": inst_name,
                }
            ],
            "forbidden_inst_uuids": [],
        },
    }


def _by_uuid(items):
    return {item["inst_uuid"]: item for item in items}


def _query(monkeypatch, inst_uuids, cmdb, monitor=None):
    def quiet_monitor(**kwargs):
        return {"result": True, "data": {"instance_summaries": []}}

    _patch_user(monkeypatch)
    _cmdb(monkeypatch, cmdb)
    _monitor(monkeypatch, monitor or quiet_monitor)
    return ArchitectureNodeStatusService.query(SimpleNamespace(), inst_uuids)["items"]


def test_missing_uuid_is_invalid_without_name(monkeypatch):
    inst_uuid = _uuid(1)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: {"result": True, "data": {"items": [], "forbidden_inst_uuids": []}},
    )
    assert items == [
        {
            "inst_uuid": inst_uuid,
            "status": "invalid",
            "alert_count": 0,
            "max_level": None,
            "level_counts": {"critical": 0, "error": 0, "warning": 0},
            "alerts": [],
            "monitor_id": "",
            "model_id": "",
            "inst_name": "",
        }
    ]


def test_forbidden_uuid_hides_name(monkeypatch):
    inst_uuid = _uuid(2)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: {
            "result": True,
            "data": {"items": [], "forbidden_inst_uuids": [inst_uuid]},
        },
    )
    row = items[0]
    assert row["status"] == "forbidden"
    assert row["inst_name"] == ""
    assert row["model_id"] == ""
    assert SECRET not in json.dumps(row)


def test_empty_monitor_id_is_unmonitored(monkeypatch):
    inst_uuid = _uuid(3)
    items = _query(monkeypatch, [inst_uuid], lambda **kwargs: _mapping(inst_uuid, monitor_id="", inst_name="quiet"))
    row = items[0]
    assert row["status"] == "unmonitored"
    assert row["inst_name"] == "quiet"
    assert row["monitor_id"] == ""
    assert row["alert_count"] == 0


def test_monitor_exception_marks_that_batch_unknown(monkeypatch):
    inst_uuid = _uuid(4)

    def monitor(**kwargs):
        raise RuntimeError(f"monitor down {SECRET}")

    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-4", inst_name="web-04"),
        monitor,
    )
    row = items[0]
    assert row["status"] == "unknown"
    assert row["inst_name"] == "web-04"
    assert row["monitor_id"] == "mon-4"
    assert SECRET not in json.dumps(row)


def test_missing_summary_is_unknown(monkeypatch):
    inst_uuid = _uuid(5)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-5"),
        lambda **kwargs: {"result": True, "data": {"instance_summaries": []}},
    )
    assert items[0]["status"] == "unknown"
    assert items[0]["alert_count"] == 0


def test_zero_count_is_normal(monkeypatch):
    inst_uuid = _uuid(6)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-6", inst_name="ok"),
        lambda **kwargs: {
            "result": True,
            "data": {"instance_summaries": [{"instance_id": "mon-6", "count": 0, "max_level": None}]},
        },
    )
    assert items[0]["status"] == "normal"
    assert items[0]["alert_count"] == 0
    assert items[0]["max_level"] is None
    assert items[0]["inst_name"] == "ok"


@pytest.mark.parametrize(
    ("level", "status"),
    [("critical", "critical"), ("error", "critical"), ("warning", "warning")],
)
def test_alert_level_maps_with_count(monkeypatch, level, status):
    inst_uuid = _uuid(7)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-7", inst_name="alerted"),
        lambda **kwargs: {
            "result": True,
            "data": {"instance_summaries": [{"instance_id": "mon-7", "count": 3, "max_level": level}]},
        },
    )
    assert items[0]["status"] == status
    assert items[0]["alert_count"] == 3
    assert items[0]["max_level"] == level


def test_level_counts_split_severe_and_warning_and_keep_icon_total(monkeypatch):
    inst_uuid = _uuid(12)
    captured = {}

    def monitor(**kwargs):
        captured["query_data"] = kwargs["query_data"]
        return {
            "result": True,
            "data": {
                "instance_summaries": [
                    {
                        "instance_id": "mon-12",
                        "count": 5,
                        "max_level": "error",
                        "level_counts": {"critical": 1, "error": 1, "warning": 3},
                        "alerts": [
                            {"id": "a-critical", "level": "critical"},
                            {"id": "a-error", "level": "error"},
                            {"id": "a-warn", "level": "warning"},
                            {"id": "a-warn", "level": "warning"},
                            {"id": "a-warn-2", "level": "warning"},
                            {"id": "a-warn-3", "level": "warning"},
                            {"id": "info-skip", "level": "info"},
                        ],
                    }
                ]
            },
        }

    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-12", inst_name="mixed"),
        monitor,
    )
    row = items[0]
    assert captured["query_data"]["include_alert_refs"] is True
    assert "level" not in captured["query_data"]
    assert row["status"] == "critical"
    assert row["alert_count"] == 6
    assert row["max_level"] == "critical"
    assert row["inst_name"] == "mixed"
    assert row["level_counts"] == {"critical": 1, "error": 1, "warning": 4}
    assert row["alerts"] == [
        {"id": "a-critical", "level": "critical"},
        {"id": "a-error", "level": "error"},
        {"id": "a-warn", "level": "warning"},
        {"id": "a-warn-2", "level": "warning"},
        {"id": "a-warn-3", "level": "warning"},
        {"id": "info-skip", "level": "warning"},
    ]


def test_alert_ref_rows_group_levels_without_changing_plain_summaries():
    from apps.monitor.nats.monitor import _summarize_alert_rows

    plain = _summarize_alert_rows(
        [
            {"monitor_instance_id": "mon", "level": "error"},
            {"monitor_instance_id": "mon", "level": "warning"},
        ],
        ["mon"],
        False,
    )
    assert plain == [{"instance_id": "mon", "count": 2, "max_level": "error"}]
    detailed = _summarize_alert_rows(
        [
            {"id": 1, "monitor_instance_id": "mon", "level": "error"},
            {"id": 2, "monitor_instance_id": "mon", "level": "warning"},
            {"id": 2, "monitor_instance_id": "mon", "level": "warning"},
            {"id": 3, "monitor_instance_id": "mon", "level": "info"},
        ],
        ["mon"],
        True,
    )
    assert detailed[0]["count"] == 4
    assert detailed[0]["level_counts"] == {"critical": 0, "error": 1, "warning": 1}
    assert detailed[0]["alerts"] == [
        {"id": "1", "level": "error"},
        {"id": "2", "level": "warning"},
    ]
    assert detailed[0]["other_alerts"] == [{"id": "3", "level": "info"}]
    assert "other_alerts" not in plain[0]


def test_info_only_alert_is_warning(monkeypatch):
    inst_uuid = _uuid(13)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-13", inst_name="info-host"),
        lambda **kwargs: {
            "result": True,
            "data": {
                "instance_summaries": [
                    {
                        "instance_id": "mon-13",
                        "count": 1,
                        "max_level": "info",
                        "level_counts": {"critical": 0, "error": 0, "warning": 0},
                        "alerts": [],
                        "other_alerts": [{"id": "info-1", "level": "info"}],
                    }
                ]
            },
        },
    )
    row = items[0]
    assert row["status"] == "warning"
    assert row["max_level"] == "warning"
    assert row["alert_count"] == 1
    assert row["level_counts"] == {"critical": 0, "error": 0, "warning": 1}
    assert row["alerts"] == [{"id": "info-1", "level": "warning"}]
    assert row["inst_name"] == "info-host"


def test_warning_plus_info_stays_warning(monkeypatch):
    inst_uuid = _uuid(14)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-14", inst_name="mixed-warn"),
        lambda **kwargs: {
            "result": True,
            "data": {
                "instance_summaries": [
                    {
                        "instance_id": "mon-14",
                        "count": 2,
                        "max_level": "info",
                        "level_counts": {"critical": 0, "error": 0, "warning": 1},
                        "alerts": [{"id": "warn-1", "level": "warning"}],
                        "other_alerts": [{"id": "info-1", "level": "info"}],
                    }
                ]
            },
        },
    )
    row = items[0]
    assert row["status"] == "warning"
    assert row["max_level"] == "warning"
    assert row["alert_count"] == 2
    assert row["level_counts"] == {"critical": 0, "error": 0, "warning": 2}


def test_critical_plus_info_stays_critical(monkeypatch):
    inst_uuid = _uuid(15)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-15", inst_name="mixed-critical"),
        lambda **kwargs: {
            "result": True,
            "data": {
                "instance_summaries": [
                    {
                        "instance_id": "mon-15",
                        "count": 2,
                        "max_level": "critical",
                        "alerts": [{"id": "crit-1", "level": "critical"}],
                        "other_alerts": [{"id": "info-1", "level": "info"}],
                    }
                ]
            },
        },
    )
    row = items[0]
    assert row["status"] == "critical"
    assert row["max_level"] == "critical"
    assert row["alert_count"] == 2
    assert row["level_counts"] == {"critical": 1, "error": 0, "warning": 1}


def test_info_alert_id_counts_once_as_warning(monkeypatch):
    inst_uuid = _uuid(16)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-16", inst_name="deduped"),
        lambda **kwargs: {
            "result": True,
            "data": {
                "instance_summaries": [
                    {
                        "instance_id": "mon-16",
                        "count": 4,
                        "max_level": "info",
                        "alerts": [{"id": "warn-1", "level": "warning"}],
                        "other_alerts": [
                            {"id": "info-shared", "level": "info"},
                            {"id": "info-shared", "level": "info"},
                            {"id": "notice-1", "level": "notice"},
                        ],
                    }
                ]
            },
        },
    )
    row = items[0]
    assert row["status"] == "warning"
    assert row["max_level"] == "warning"
    assert row["alert_count"] == 3
    assert row["level_counts"] == {"critical": 0, "error": 0, "warning": 3}
    assert row["alerts"] == [
        {"id": "warn-1", "level": "warning"},
        {"id": "info-shared", "level": "warning"},
        {"id": "notice-1", "level": "warning"},
    ]


def test_blank_count_stays_unknown(monkeypatch):
    inst_uuid = _uuid(8)
    items = _query(
        monkeypatch,
        [inst_uuid],
        lambda **kwargs: _mapping(inst_uuid, monitor_id="mon-8"),
        lambda **kwargs: {
            "result": True,
            "data": {"instance_summaries": [{"instance_id": "mon-8", "count": "", "max_level": "critical"}]},
        },
    )
    assert items[0]["status"] == "unknown"
    assert items[0]["alert_count"] == 0
    assert items[0]["max_level"] is None


def test_cmdb_batch_failure_does_not_affect_other_batch(monkeypatch, caplog):
    first = [_uuid(index) for index in range(200)]
    survivor = _uuid(200)
    calls = {"n": 0}

    def cmdb(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError(f"cmdb chunk down {SECRET}")
        inst_uuid = kwargs["inst_uuids"][0]
        return _mapping(inst_uuid, monitor_id="", inst_name="kept-name")

    with caplog.at_level(logging.ERROR, logger="operation_analysis"):
        items = _query(monkeypatch, [*first, survivor], cmdb)

    by_uuid = _by_uuid(items)
    assert all(by_uuid[inst_uuid]["status"] == "unknown" for inst_uuid in first)
    assert all(by_uuid[inst_uuid]["inst_name"] == "" for inst_uuid in first)
    assert by_uuid[survivor]["status"] == "unmonitored"
    assert by_uuid[survivor]["inst_name"] == "kept-name"
    error_records = [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert len(error_records) == 1
    record = error_records[0]
    assert record.msg == ("event=architecture_node_status_batch_failed failed_stage=%s error_type=%s batch_index=%s batch_size=%s")
    assert record.args == ("monitor_ids", "RuntimeError", 0, 200)
    assert record.exc_info[0] is SafeLogException
    assert record.exc_info[2] is not None
    rendered = f"{record.getMessage()}\n{logging.Formatter().formatException(record.exc_info)}"
    assert SECRET not in rendered
    assert SECRET not in json.dumps(items)


def test_monitor_batch_failure_does_not_affect_other_batch(monkeypatch):
    first = [_uuid(index) for index in range(200)]
    survivor = _uuid(300)
    monitor_calls = {"n": 0}

    def cmdb(**kwargs):
        return {
            "result": True,
            "data": {
                "items": [
                    {
                        "inst_uuid": inst_uuid,
                        "model_id": "host",
                        "monitor_id": f"mon-{inst_uuid[-3:]}",
                        "inst_name": f"name-{inst_uuid[-3:]}",
                    }
                    for inst_uuid in kwargs["inst_uuids"]
                ],
                "forbidden_inst_uuids": [],
            },
        }

    def monitor(**kwargs):
        monitor_calls["n"] += 1
        if monitor_calls["n"] == 1:
            return {"result": False, "data": {"secret": SECRET}, "message": SECRET}
        instance_id = kwargs["query_data"]["instance_ids"][0]
        return {
            "result": True,
            "data": {"instance_summaries": [{"instance_id": instance_id, "count": 0, "max_level": None}], "secret": SECRET},
        }

    items = _query(monkeypatch, [*first, survivor], cmdb, monitor)
    by_uuid = _by_uuid(items)
    assert all(by_uuid[inst_uuid]["status"] == "unknown" for inst_uuid in first)
    assert by_uuid[first[0]]["inst_name"].startswith("name-")
    assert by_uuid[survivor]["status"] == "normal"
    assert SECRET not in json.dumps(items)


def test_user_info_comes_from_request_and_duplicate_uuids_collapse(monkeypatch):
    inst_uuid = _uuid(9)
    captured = {}

    def cmdb(**kwargs):
        captured["user_info"] = kwargs["user_info"]
        captured["inst_uuids"] = kwargs["inst_uuids"]
        return _mapping(inst_uuid, monitor_id="mon-9", inst_name="only-alice")

    _patch_user(monkeypatch, {"user": "alice", "team": 7})
    _cmdb(monkeypatch, cmdb)
    _monitor(
        monkeypatch,
        lambda **kwargs: {
            "result": True,
            "data": {"instance_summaries": [{"instance_id": "mon-9", "count": 0, "max_level": None}]},
        },
    )
    items = ArchitectureNodeStatusService.query(
        SimpleNamespace(data={"user_info": {"user": "mallory"}}),
        [inst_uuid.upper(), inst_uuid],
    )["items"]
    assert captured["user_info"]["user"] == "alice"
    assert captured["inst_uuids"] == [inst_uuid]
    assert len(items) == 1
    assert items[0]["inst_name"] == "only-alice"


def test_more_than_500_unique_uuids_is_rejected(monkeypatch):
    called = {"cmdb": False}

    def cmdb(**kwargs):
        called["cmdb"] = True
        return {"result": True, "data": {"items": [], "forbidden_inst_uuids": []}}

    _patch_user(monkeypatch)
    _cmdb(monkeypatch, cmdb)
    with pytest.raises(ValidationError):
        ArchitectureNodeStatusService.query(SimpleNamespace(), [_uuid(index) for index in range(MAX_INST_UUIDS + 1)])
    assert called["cmdb"] is False


def test_non_list_is_rejected():
    with pytest.raises(ValidationError):
        ArchitectureNodeStatusService.query(SimpleNamespace(), "not-a-list")


def test_view_returns_items_and_share_has_no_endpoint(monkeypatch):
    inst_uuid = _uuid(10)

    def query(request, inst_uuids):
        assert inst_uuids == [inst_uuid]
        return {
            "items": [
                {
                    "inst_uuid": inst_uuid,
                    "status": "normal",
                    "alert_count": 0,
                    "max_level": None,
                    "monitor_id": "mon-10",
                    "model_id": "host",
                    "inst_name": "web-10",
                }
            ]
        }

    monkeypatch.setattr(ArchitectureNodeStatusService, "query", staticmethod(query))
    request = APIRequestFactory().post(
        "/operation_analysis/api/architecture/node_status/",
        {"inst_uuids": [inst_uuid]},
        format="json",
    )
    force_authenticate(request, user=SimpleNamespace(is_authenticated=True, is_superuser=True, username="alice", locale="zh"))
    response = ArchitectureModelViewSet.as_view({"post": "node_status"})(request)
    body = _render(response)
    assert response.status_code == 200
    assert body["result"] is True
    assert body["data"]["items"][0]["status"] == "normal"
    assert not hasattr(DashboardShareAccessViewSet, "node_status")


def test_view_rejects_user_without_architecture_permission():
    request = APIRequestFactory().post(
        "/operation_analysis/api/architecture/node_status/",
        {"inst_uuids": [_uuid(11)]},
        format="json",
    )
    force_authenticate(
        request,
        user=SimpleNamespace(
            is_authenticated=True,
            is_superuser=False,
            username="bob",
            locale="zh",
            permission={},
        ),
    )
    response = ArchitectureModelViewSet.as_view({"post": "node_status"})(request)
    assert response.status_code == 403
