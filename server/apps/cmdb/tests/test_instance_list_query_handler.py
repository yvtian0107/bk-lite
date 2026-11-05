import logging
import traceback

import pytest

from apps.cmdb.nats import nats

SENTINEL = "td_probe_filter_secret"


PERMISSION = {1: {"inst_names": ["web"]}}
USER_INFO = {"user": "alice", "team": 1}
HOST_ATTRS = [
    {"attr_id": "ip_addr", "attr_name": "内网IP", "attr_type": "str", "is_required": True},
    {"attr_id": "os_type", "attr_name": "系统类型", "attr_type": "enum", "enum_select_mode": "single"},
    {"attr_id": "enabled", "attr_name": "启用", "attr_type": "bool"},
]


def _patch_visible_host(monkeypatch, instances, count=None, groups=None, attrs=None):
    calls = {"list": None, "group": None, "search": 0, "attrs": None}

    monkeypatch.setattr(nats, "_build_nats_model_permission_map", lambda user_info: PERMISSION)
    monkeypatch.setattr(nats, "_build_nats_permission_map", lambda user_info, model_id="", **kwargs: PERMISSION)

    def search_model(**kwargs):
        calls["search"] += 1
        calls["search_perm"] = kwargs.get("permissions_map")
        return [{"model_id": "host", "model_name": "主机"}, {"model_id": "nginx", "model_name": "Nginx"}]

    def search_attrs(model_id, language="zh-Hans"):
        calls["attrs"] = (model_id, language)
        return HOST_ATTRS if attrs is None else attrs

    def instance_list(**kwargs):
        calls["list"] = kwargs
        rows = instances
        total = len(rows) if count is None else count
        return rows, total

    def group_inst_count(**kwargs):
        calls["group"] = kwargs
        return {} if groups is None else groups

    monkeypatch.setattr(nats.ModelManage, "search_model", search_model)
    monkeypatch.setattr(nats.ModelManage, "search_model_attr", search_attrs)
    monkeypatch.setattr(nats.InstanceManage, "instance_list", instance_list)
    monkeypatch.setattr(nats.InstanceManage, "group_inst_count", group_inst_count)
    return calls


def test_missing_model_fails_without_query(monkeypatch):
    calls = _patch_visible_host(monkeypatch, [])
    out = nats.query_model_instances(model_id="", analysis_mode="count", user_info=USER_INFO)
    assert out["result"] is False
    assert "请选择模型" in out["message"]
    assert out["data"]["items"] == []
    assert [field["key"] for field in out["data"]["fields"]] == ["inst_uuid", "inst_name", "model_id"]
    assert calls["list"] is None
    assert calls["group"] is None
    assert calls["search"] == 0


def test_missing_analysis_mode_fails_without_query(monkeypatch):
    calls = _patch_visible_host(monkeypatch, [])
    out = nats.query_model_instances(model_id="host", user_info=USER_INFO)
    assert out["result"] is False
    assert "请选择分析方式" in out["message"]
    assert calls["list"] is None
    assert calls["group"] is None


def test_authorized_model_returns_detail_rows(monkeypatch):
    calls = _patch_visible_host(
        monkeypatch,
        [
            {
                "inst_uuid": "u1",
                "inst_name": "web",
                "model_id": "host",
                "ip_addr": "10.0.0.8",
                "_id": 3,
            }
        ],
        count=8,
        attrs=[{"attr_id": "ip_addr", "attr_name": "内网IP", "attr_type": "str", "is_required": True}],
    )
    out = nats.query_model_instances(
        model_id="host",
        analysis_mode="list",
        attr_filters="ip_addr=10.0.0.8",
        order="-ip_addr",
        page=2,
        page_size=5,
        organization=999,
        user_info=USER_INFO,
    )

    assert out["result"] is True
    assert out["message"] == ""
    assert out["data"]["count"] == 8
    assert out["data"]["items"] == [
        {"inst_uuid": "u1", "inst_name": "web", "model_id": "host", "ip_addr": "10.0.0.8"}
    ]
    assert calls["group"] is None
    assert calls["list"]["model_id"] == "host"
    assert calls["list"]["permission_map"] == PERMISSION
    assert calls["list"]["params"] == [{"field": "ip_addr", "type": "str=", "value": "10.0.0.8"}]
    assert calls["list"]["order"] == "-ip_addr"
    assert calls["list"]["page"] == 2
    assert calls["list"]["page_size"] == 5
    assert calls["list"]["creator"] == "alice"
    assert calls["attrs"][0] == "host"


def test_count_returns_filtered_total_for_one_model(monkeypatch):
    calls = _patch_visible_host(monkeypatch, [{"inst_name": "only-page"}], count=30)
    out = nats.query_model_instances(
        model_id="host",
        analysis_mode="count",
        attr_filters="ip_addr=10.0.0.8",
        page=1,
        page_size=5,
        organization=999,
        user_info=USER_INFO,
    )

    assert out["result"] is True
    assert out["data"]["count"] == 1
    assert out["data"]["items"] == [{"model_id": "host", "count": 30}]
    assert [field["key"] for field in out["data"]["fields"]] == ["model_id", "count"]
    assert calls["group"] is None
    assert calls["list"]["model_id"] == "host"
    assert calls["list"]["page"] == 1
    assert calls["list"]["page_size"] == 1
    assert calls["list"]["permission_map"] == PERMISSION
    assert calls["list"]["params"] == [{"field": "ip_addr", "type": "str=", "value": "10.0.0.8"}]


def test_distribution_groups_only_the_selected_model(monkeypatch):
    calls = _patch_visible_host(monkeypatch, [], groups={"linux": 2, "windows": 5})
    out = nats.query_model_instances(
        model_id="host",
        analysis_mode="distribution",
        group_by="os_type",
        attr_filters="enabled=true",
        page=1,
        page_size=20,
        user_info=USER_INFO,
    )

    assert out["result"] is True
    assert out["data"]["count"] == 2
    assert out["data"]["items"] == [
        {"model_id": "host", "group_value": "windows", "count": 5},
        {"model_id": "host", "group_value": "linux", "count": 2},
    ]
    assert calls["list"] is None
    assert calls["group"]["group_by_attr"] == "os_type"
    assert calls["group"]["permissions_map"] == PERMISSION
    assert calls["group"]["creator"] == "alice"
    assert calls["group"]["params"] == [
        {"field": "model_id", "type": "str=", "value": "host"},
        {"field": "enabled", "type": "bool", "value": True},
    ]


def test_numeric_aggregation_fails_without_query(monkeypatch):
    calls = _patch_visible_host(monkeypatch, [{"inst_name": "web"}], count=4, groups={"linux": 4})
    out = nats.query_model_instances(
        model_id="host",
        analysis_mode="aggregate",
        agg_field="cpu_count",
        agg_func="sum",
        user_info=USER_INFO,
    )
    assert out["result"] is False
    assert "数值聚合暂不支持" in out["message"]
    assert out["data"]["items"] == []
    assert calls["list"] is None
    assert calls["group"] is None


def test_empty_result_keeps_fields(monkeypatch):
    _patch_visible_host(
        monkeypatch,
        [],
        count=0,
        attrs=[{"attr_id": "ip_addr", "attr_name": "内网IP", "attr_type": "str", "is_required": True}],
    )
    out = nats.query_model_instances(model_id="host", analysis_mode="list", user_info=USER_INFO)
    assert out["result"] is True
    assert out["data"]["items"] == []
    assert out["data"]["count"] == 0
    assert [field["key"] for field in out["data"]["fields"]] == ["inst_uuid", "inst_name", "model_id", "ip_addr"]


@pytest.mark.parametrize("mode", ["list", "count", "distribution", "aggregate"])
def test_no_permission_does_not_query_or_widen(monkeypatch, mode):
    queried = {"list": False, "search": False, "group": False}
    monkeypatch.setattr(nats, "_build_nats_model_permission_map", lambda user_info: None)
    monkeypatch.setattr(nats, "_build_nats_permission_map", lambda user_info, model_id="", **kwargs: None)
    monkeypatch.setattr(
        nats.ModelManage,
        "search_model",
        lambda **kwargs: queried.__setitem__("search", True) or [{"model_id": "host"}],
    )
    monkeypatch.setattr(
        nats.InstanceManage,
        "instance_list",
        lambda **kwargs: queried.__setitem__("list", True) or ([{"inst_uuid": "all"}], 1),
    )
    monkeypatch.setattr(
        nats.InstanceManage,
        "group_inst_count",
        lambda **kwargs: queried.__setitem__("group", True) or {"host": 9},
    )

    out = nats.query_model_instances(model_id="host", analysis_mode=mode, group_by="os_type", user_info={})

    assert queried == {"list": False, "search": False, "group": False}
    assert out["result"] is True
    assert out["data"]["items"] == []
    assert [field["key"] for field in out["data"]["fields"]] == ["inst_uuid", "inst_name", "model_id"]


def test_invisible_model_does_not_list_instances(monkeypatch):
    queried = {"list": False, "group": False}
    monkeypatch.setattr(nats, "_build_nats_model_permission_map", lambda user_info: PERMISSION)
    monkeypatch.setattr(nats, "_build_nats_permission_map", lambda user_info, model_id="", **kwargs: PERMISSION)
    monkeypatch.setattr(nats.ModelManage, "search_model", lambda **kwargs: [{"model_id": "nginx", "model_name": "Nginx"}])
    monkeypatch.setattr(
        nats.InstanceManage,
        "instance_list",
        lambda **kwargs: queried.__setitem__("list", True) or ([], 0),
    )
    monkeypatch.setattr(
        nats.InstanceManage,
        "group_inst_count",
        lambda **kwargs: queried.__setitem__("group", True) or {"linux": 1},
    )

    out = nats.query_model_instances(model_id="host", analysis_mode="distribution", group_by="os_type", user_info=USER_INFO)

    assert queried == {"list": False, "group": False}
    assert out["result"] is False
    assert "不可见" in out["message"]
    assert out["data"]["items"] == []


def test_unsupported_filter_does_not_drop_the_condition(monkeypatch):
    calls = _patch_visible_host(monkeypatch, [{"inst_uuid": "u1", "inst_name": "web", "model_id": "host"}])
    out = nats.query_model_instances(
        model_id="host",
        analysis_mode="list",
        attr_filters="ip_addr!=10.0.0.1",
        user_info=USER_INFO,
    )
    assert out["result"] is False
    assert "仅支持等值" in out["message"]
    assert calls["list"] is None
    assert calls["group"] is None


def test_unexpected_query_failure_logs_one_traceback_without_filter_text(monkeypatch, caplog):
    _patch_visible_host(monkeypatch, [])

    def explode(**kwargs):
        raise RuntimeError(f"graph down {SENTINEL}")

    monkeypatch.setattr(nats.InstanceManage, "instance_list", explode)
    caplog.set_level(logging.ERROR, logger="cmdb")

    out = nats.query_model_instances(
        model_id="host",
        analysis_mode="list",
        attr_filters=f"ip_addr={SENTINEL}",
        user_info=USER_INFO,
    )

    assert out["result"] is False
    assert out["message"] == "实例查询失败"
    assert out["data"]["items"] == []
    assert [field["key"] for field in out["data"]["fields"]] == ["inst_uuid", "inst_name", "model_id"]
    records = [record for record in caplog.records if record.name == "cmdb" and record.levelno >= logging.ERROR]
    assert len(records) == 1
    record = records[0]
    assert record.msg == "event=cmdb_instance_query_failed model_id=%s failed_stage=%s error_type=%s"
    assert record.args == ("host", "query", "RuntimeError")
    assert record.getMessage() == "event=cmdb_instance_query_failed model_id=host failed_stage=query error_type=RuntimeError"
    assert record.exc_info is not None
    assert record.exc_info[0].__name__ == "SafeLogException"
    assert str(record.exc_info[1]) == "RuntimeError"
    rendered = logging.Formatter("%(message)s").format(record)
    formatted = "".join(traceback.format_exception(*record.exc_info))
    blob = "\n".join([record.getMessage(), rendered, formatted, caplog.text])
    assert SENTINEL not in blob
    assert "Traceback (most recent call last)" in formatted


def test_model_options_follow_permission_and_do_not_expand(monkeypatch):
    monkeypatch.setattr(nats, "_build_nats_model_permission_map", lambda user_info: None)
    monkeypatch.setattr(nats.ModelManage, "search_model", lambda **kwargs: [{"model_id": "host", "model_name": "主机"}])
    empty = nats.get_model_options(user_info={})
    assert empty == {"result": True, "data": [], "message": ""}

    monkeypatch.setattr(nats, "_build_nats_model_permission_map", lambda user_info: PERMISSION)
    seen = {}

    def search_model(**kwargs):
        seen["permissions_map"] = kwargs.get("permissions_map")
        return [
            {"model_id": "nginx", "model_name": "Nginx"},
            {"model_id": "host", "model_name": "主机"},
            {"model_id": "", "model_name": "空"},
        ]

    monkeypatch.setattr(nats.ModelManage, "search_model", search_model)
    out = nats.get_model_options(user_info=USER_INFO)
    assert seen["permissions_map"] == PERMISSION
    assert out["data"] == [
        {"model_id": "nginx", "model_name": "Nginx"},
        {"model_id": "host", "model_name": "主机"},
    ]
