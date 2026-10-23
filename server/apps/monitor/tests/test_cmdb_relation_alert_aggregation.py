from types import SimpleNamespace

import pytest

from apps.monitor.nats import monitor as nm
from apps.monitor.services.cmdb_relation_alerts import build_relation_alert_view


def test_relation_alert_view_counts_hosts_without_edges_as_clear():
    entities = [
        {"inst_uuid": "app-1", "inst_name": "订单系统"},
        {"inst_uuid": "app-2", "inst_name": "门户"},
        {"inst_uuid": "app-3", "inst_name": "空应用"},
    ]
    edges = [
        {
            "src_model_id": "application",
            "dst_model_id": "host",
            "src_inst_uuid": "app-1",
            "dst_inst_uuid": "host-1",
        },
        {
            "src_model_id": "application",
            "dst_model_id": "host",
            "src_inst_uuid": "app-1",
            "dst_inst_uuid": "host-2",
        },
        {
            "src_model_id": "host",
            "dst_model_id": "application",
            "src_inst_uuid": "host-9",
            "dst_inst_uuid": "app-2",
        },
    ]

    summary = build_relation_alert_view(
        entities=entities,
        edges=edges,
        alert_count_by_peer={"host-1": 2, "host-9": 0},
        source_model_id="application",
        peer_model_id="host",
        view="summary",
    )
    assert summary == {"total_count": 3, "with_alert_count": 1, "without_alert_count": 2}

    distribution = build_relation_alert_view(
        entities=entities,
        edges=edges,
        alert_count_by_peer={"host-1": 2},
        source_model_id="application",
        peer_model_id="host",
        view="distribution",
    )
    assert distribution == [
        {"name": "存在关联告警", "value": 1, "key": "with_alert"},
        {"name": "无关联告警", "value": 2, "key": "without_alert"},
    ]

    top = build_relation_alert_view(
        entities=entities,
        edges=edges,
        alert_count_by_peer={"host-1": 2, "host-2": 3},
        source_model_id="application",
        peer_model_id="host",
        view="top",
        limit=1,
    )
    assert top == [
        {"name": "订单系统", "value": 5, "inst_uuid": "app-1", "host_count": 2, "alert_count": 5},
    ]


def test_relation_alert_handler_uses_authorized_host_cmdb_ids(monkeypatch):
    class FakeManager:
        def filter(self, **kwargs):
            assert kwargs == {"name": "Host"}
            return self

        def first(self):
            return SimpleNamespace(id=3)

    monkeypatch.setattr(nm, "MonitorObject", SimpleNamespace(objects=FakeManager()))
    monkeypatch.setattr(nm, "_get_nats_actor_scope", lambda user_info: (None, 1, False, frozenset({1}), False, None))
    monkeypatch.setattr(
        nm,
        "_get_authorized_monitor_instances",
        lambda user_info, scope_ids, monitor_obj_id=None: (
            {
                "mon-1": SimpleNamespace(id="mon-1", cmdb_id="host-1"),
            },
            None,
        ),
    )
    monkeypatch.setattr(nm, "_count_new_monitor_alerts", lambda instance_ids: {"mon-1": 4, "mon-2": 9})
    monkeypatch.setattr(
        nm,
        "list_model_association_options",
        lambda language, model_id: [
            {"model_asst_id": "application_run_host", "src_model_id": "application", "dst_model_id": "host"},
        ],
    )
    monkeypatch.setattr(
        nm,
        "query_association_edges",
        lambda model_asst_id, uuids: [
            {
                "src_model_id": "application",
                "dst_model_id": "host",
                "src_inst_uuid": "app-1",
                "dst_inst_uuid": "host-1",
            },
            {
                "src_model_id": "application",
                "dst_model_id": "host",
                "src_inst_uuid": "app-1",
                "dst_inst_uuid": "host-hidden",
            },
        ],
    )
    monkeypatch.setattr(
        nm.InstanceManage,
        "instance_list",
        lambda **kwargs: ([{"inst_uuid": "app-1", "inst_name": "订单"}, {"inst_uuid": "app-2", "inst_name": "空"}], 2),
    )

    import apps.cmdb.nats.nats as cmdb_nats

    monkeypatch.setattr(cmdb_nats, "_build_nats_permission_map", lambda user_info, model_id="": {"1": {}})
    monkeypatch.setattr(cmdb_nats, "_resolve_nats_cmdb_language", lambda user_info=None: "zh-Hans")

    result = nm.get_cmdb_relation_alert_aggregation(
        model_id="application",
        model_asst_id="application_run_host",
        peer_model_id="host",
        view="summary",
        user_info={"user": "u", "team": 1},
    )

    assert result["result"] is True
    assert result["data"] == {"total_count": 2, "with_alert_count": 1, "without_alert_count": 1}


def test_relation_alert_handler_empty_permission_skips_queries(monkeypatch):
    def fail_instances(**kwargs):
        raise AssertionError("no permission must not list instances")

    monkeypatch.setattr(nm.InstanceManage, "instance_list", fail_instances)
    import apps.cmdb.nats.nats as cmdb_nats

    monkeypatch.setattr(cmdb_nats, "_build_nats_permission_map", lambda user_info, model_id="": None)

    result = nm.get_cmdb_relation_alert_aggregation(
        model_id="application",
        model_asst_id="application_run_host",
        view="distribution",
        user_info={"user": "u", "team": 1},
    )

    assert result["result"] is True
    assert result["data"][0]["key"] == "with_alert"
    assert result["data"][0]["value"] == 0


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"model_asst_id": "application_run_host"}, "模型不能为空"),
        ({"model_id": "application", "view": "other"}, "view"),
    ],
)
def test_relation_alert_handler_rejects_bad_input(kwargs, message):
    result = nm.get_cmdb_relation_alert_aggregation(**kwargs)
    assert result["result"] is False
    assert message in result["message"]
