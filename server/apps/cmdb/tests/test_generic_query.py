"""CMDB 通用查询的统计口径、上限和空结果。"""

import re

import pytest

from apps.cmdb.services.generic_query import GenericQueryError, query_instances, query_models, query_one_hop_relations
from apps.cmdb.services.generic_query_columns import build_instance_column_fields, build_one_hop_column_fields, project_one_hop_rows
from apps.cmdb.services.generic_query_limits import DETAIL_PAGE_SIZE_MAX, SCAN_INSTANCE_MAX, STAT_GROUP_MAX


def _model(model_id, name, classification_id, classification_name):
    return {
        "model_id": model_id,
        "model_name": name,
        "classification_id": classification_id,
        "classification_name": classification_name,
    }


DETAIL_COLUMNS = ("classification_name", "model_name", "model_id", "instance_count")


def test_model_detail_returns_only_definition_columns():
    payload = query_models(
        models=[
            _model("host", "主机", "compute", "计算"),
            _model("room", "机房", "space", "空间"),
        ],
        instance_counts={"host": 5},
        analysis_mode="detail",
        model_ids=["host"],
        page=1,
        page_size=20,
    )
    empty = query_models(
        models=[_model("host", "主机", "compute", "计算")],
        instance_counts={"host": 1},
        analysis_mode="detail",
        classification_id="space",
    )

    assert list(payload["items"][0]) == list(DETAIL_COLUMNS)
    assert payload["items"][0] == {
        "classification_name": "计算",
        "model_name": "主机",
        "model_id": "host",
        "instance_count": 5,
    }
    assert empty["structure"] == "table"
    assert empty["status"] == "empty"
    assert empty["items"] == []
    assert empty["count"] == 0
    for row in payload["items"]:
        assert set(row) == set(DETAIL_COLUMNS)


def test_model_detail_keeps_zero_instance_models_and_top_sort():
    rows = query_models(
        models=[
            _model("host", "主机", "compute", "计算"),
            _model("net", "网络", "compute", "计算"),
            _model("room", "机房", "space", "空间"),
        ],
        instance_counts={"host": 5, "room": 0},
        analysis_mode="detail",
        page=1,
        page_size=2,
    )

    assert rows["status"] == "ok"
    assert rows["count"] == 3
    assert [item["model_id"] for item in rows["items"]] == ["room", "host"]
    assert rows["items"][0]["instance_count"] == 0


def test_model_count_is_the_number_of_models_in_scope():
    models = [
        _model("host", "主机", "compute", "计算"),
        _model("net", "网络", "compute", "计算"),
    ]
    counts = {"host": 2, "net": 0}
    counted = query_models(models=models, instance_counts=counts, analysis_mode="count")
    narrowed = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="count",
        model_ids=["net"],
    )

    assert counted == {
        "structure": "value",
        "status": "ok",
        "model_count": 2,
        "unit": "个",
        "aggregation": "模型计数",
        "fields": [{"key": "model_count", "title": "模型数", "value_type": "number", "role": "measure"}],
    }
    assert narrowed["model_count"] == 1
    assert "value" not in narrowed
    assert narrowed["aggregation"] == "模型计数"


def test_model_distribution_is_one_item_per_model_and_keeps_zero():
    models = [
        _model("host", "主机", "compute", "计算"),
        _model("net", "网络", "compute", "计算"),
        _model("room", "机房", "space", "空间"),
    ]
    payload = query_models(
        models=models,
        instance_counts={"host": 2, "net": 3},
        analysis_mode="distribution",
    )
    classified = query_models(
        models=models,
        instance_counts={"host": 2, "net": 3},
        analysis_mode="distribution",
        classification_id="compute",
    )
    selected = query_models(
        models=models,
        instance_counts={"host": 2, "net": 3},
        analysis_mode="distribution",
        model_ids=["room"],
    )
    counted = query_models(
        models=models,
        instance_counts={"host": 2, "net": 3},
        analysis_mode="count",
        classification_id="compute",
    )

    assert payload["status"] == "ok"
    assert payload["page"] == 1
    assert payload["page_size"] == 3
    assert payload["count"] == 3
    assert payload["unit"] == "个"
    assert payload["aggregation"] == "按模型统计权限内实例数，含零实例模型"
    assert payload["items"] == [
        {"classification_name": "计算", "model_name": "网络", "model_id": "net", "instance_count": 3},
        {"classification_name": "计算", "model_name": "主机", "model_id": "host", "instance_count": 2},
        {"classification_name": "空间", "model_name": "机房", "model_id": "room", "instance_count": 0},
    ]
    assert [field["key"] for field in payload["fields"]] == [
        "classification_name",
        "model_name",
        "model_id",
        "instance_count",
    ]
    assert [item["model_id"] for item in classified["items"]] == ["net", "host"]
    assert selected["items"] == [
        {"classification_name": "空间", "model_name": "机房", "model_id": "room", "instance_count": 0},
    ]
    assert counted["model_count"] == 2
    assert counted["aggregation"] == "模型计数"


def test_model_distribution_keeps_ties_and_disambiguates_duplicate_names():
    payload = query_models(
        models=[
            _model("host", "主机", "compute", "计算"),
            _model("host_shadow", "主机", "ops", "运维"),
            _model("literal", "主机 (host)", "ops", "运维"),
            _model("room", "机房", "space", "空间"),
        ],
        instance_counts={"host": 4, "host_shadow": 4, "literal": 1, "room": 4},
        analysis_mode="distribution",
    )

    assert [(item["model_id"], item["model_name"], item["classification_name"], item["instance_count"]) for item in payload["items"]] == [
        ("host", "主机", "计算", 4),
        ("host_shadow", "主机", "运维", 4),
        ("room", "机房", "空间", 4),
        ("literal", "主机 (host)", "运维", 1),
    ]
    assert "name" not in payload["items"][0]
    assert "value" not in payload["items"][0]


def test_model_distribution_uses_return_limit_and_rejects_page():
    models = [_model(f"m{index:02d}", f"模型{index:02d}", "compute", "计算") for index in range(12)]
    counts = {model["model_id"]: 100 - index for index, model in enumerate(models)}
    first = query_models(models=models, instance_counts=counts, analysis_mode="distribution")
    limited = query_models(models=models, instance_counts=counts, analysis_mode="distribution", page_size=10)
    with pytest.raises(GenericQueryError, match="不支持页码"):
        query_models(models=models, instance_counts=counts, analysis_mode="distribution", page=3)
    short = query_models(
        models=models[:3],
        instance_counts={"m00": 2, "m01": 0, "m02": 1},
        analysis_mode="distribution",
    )
    tied = query_models(
        models=[
            _model("b", "乙", "compute", "计算"),
            _model("a", "甲", "compute", "计算"),
            _model("c", "丙", "compute", "计算"),
        ],
        instance_counts={"b": 4, "a": 4, "c": 1},
        analysis_mode="distribution",
        page_size=2,
    )

    assert first["count"] == 12
    assert first["page"] == 1
    assert first["page_size"] == 12
    assert [item["model_id"] for item in first["items"]] == [f"m{index:02d}" for index in range(12)]
    assert [item["model_id"] for item in limited["items"]] == [f"m{index:02d}" for index in range(10)]
    assert limited["count"] == 12
    assert limited["page"] == 1
    assert limited["page_size"] == 10
    assert [(item["model_id"], item["instance_count"]) for item in short["items"]] == [("m00", 2), ("m02", 1), ("m01", 0)]
    assert first["fields"][2]["role"] == "identity"
    assert tied["count"] == 3
    assert [item["model_id"] for item in tied["items"]] == ["a", "b"]
    with pytest.raises(GenericQueryError, match="不支持分页"):
        query_models(models=models[:1], instance_counts={}, analysis_mode="count", page=1)
    with pytest.raises(GenericQueryError, match="不支持分页"):
        query_models(models=models[:1], instance_counts={}, analysis_mode="count", page_size=10)
    with pytest.raises(GenericQueryError, match="每页最多"):
        query_models(
            models=models[:1],
            instance_counts={},
            analysis_mode="distribution",
            page_size=DETAIL_PAGE_SIZE_MAX + 1,
        )
    too_many = [_model(f"g{index}", f"组{index}", "compute", "计算") for index in range(STAT_GROUP_MAX + 1)]
    with pytest.raises(GenericQueryError, match="统计分组超过"):
        query_models(models=too_many, instance_counts={}, analysis_mode="distribution", page_size=10)


def test_model_statistics_fail_when_scan_exceeds_limit():
    with pytest.raises(GenericQueryError, match=str(SCAN_INSTANCE_MAX)):
        query_models(
            models=[_model("host", "主机", "compute", "计算")],
            instance_counts={"host": SCAN_INSTANCE_MAX + 1},
            analysis_mode="count",
        )


def test_model_detail_defaults_page_when_unfilled_and_keeps_explicit_size():
    payload = query_models(
        models=[_model("host", "主机", "compute", "计算")],
        instance_counts={"host": 1},
        analysis_mode="detail",
    )
    assert payload["page"] == 1
    assert payload["page_size"] == 10
    explicit = query_models(
        models=[_model("host", "主机", "compute", "计算")],
        instance_counts={"host": 1},
        analysis_mode="detail",
        page=2,
        page_size=5,
    )
    assert explicit["page"] == 2
    assert explicit["page_size"] == 5


def test_model_detail_rejects_page_size_above_limit():
    with pytest.raises(GenericQueryError, match=str(DETAIL_PAGE_SIZE_MAX)):
        query_models(
            models=[_model("host", "主机", "compute", "计算")],
            instance_counts={"host": 1},
            analysis_mode="detail",
            page_size=DETAIL_PAGE_SIZE_MAX + 1,
        )


def test_model_count_rejects_paging():
    with pytest.raises(GenericQueryError, match="不支持分页"):
        query_models(
            models=[_model("host", "主机", "compute", "计算")],
            instance_counts={"host": 1},
            analysis_mode="count",
            page=1,
            page_size=20,
        )


def _instance_model(model_id="host", name="主机", attr_types=None, attrs=None, filters=None):
    return {
        "model_id": model_id,
        "model_name": name,
        "attr_types": attr_types or {"inst_name": "string"},
        "attrs": attrs or [],
        "filters": filters,
    }


def test_instance_count_distribution_and_missing_model(monkeypatch):
    def fake_count(params, permission_map, condition_params=None, condition_logic="AND"):
        assert permission_map == {"1": {}}
        assert params[0]["value"] == "host"
        assert condition_logic == "AND"
        assert condition_params[0]["value"] == "Linux"
        return 4

    def fake_group(group_by, params, permission_map, condition_params=None, condition_logic="AND"):
        del params, permission_map, condition_params, condition_logic
        assert group_by == "os_type"
        return {"Linux": 3, "Windows": 1}

    monkeypatch.setattr("apps.cmdb.services.generic_query.count_instances", fake_count)
    monkeypatch.setattr("apps.cmdb.services.generic_query.group_instance_counts", fake_group)
    spec = _instance_model(
        attr_types={"inst_name": "string", "os_type": "string"},
        attrs=[{"attr_id": "os_type", "attr_name": "操作系统", "attr_type": "string"}],
    )

    counted = query_instances(
        models=[{**spec, "filters": {"logic": "AND", "items": [{"field": "os_type", "op": "eq", "value": "Linux"}]}}],
        analysis_mode="count",
        permission_map={"1": {}},
    )
    grouped = query_instances(
        models=[spec],
        analysis_mode="distribution",
        permission_map={"1": {}},
        group_by="host.os_type",
    )

    assert counted["instance_count"] == 4
    assert counted["status"] == "ok"
    assert counted["fields"][0]["key"] == "instance_count"
    assert [item["host.os_type"] for item in grouped["items"]] == ["Linux", "Windows"]
    assert grouped["items"][0]["model_name"] == "主机"
    assert grouped["fields"][2]["role"] == "dimension"
    assert grouped["fields"][3]["role"] == "measure"
    with pytest.raises(GenericQueryError, match="请勾选模型"):
        query_instances(models=[], analysis_mode="detail", permission_map={"1": {}})


def test_instance_statistics_fail_over_scan_and_group_limits(monkeypatch):
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.count_instances",
        lambda *args, **kwargs: SCAN_INSTANCE_MAX + 1,
    )
    with pytest.raises(GenericQueryError, match=str(SCAN_INSTANCE_MAX)):
        query_instances(
            models=[_instance_model()],
            analysis_mode="count",
            permission_map={"1": {}},
        )

    groups = {f"os-{index}": 1 for index in range(STAT_GROUP_MAX + 1)}
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.group_instance_counts",
        lambda *args, **kwargs: groups,
    )
    with pytest.raises(GenericQueryError, match=str(STAT_GROUP_MAX)):
        query_instances(
            models=[
                _instance_model(
                    attr_types={"os_type": "string", "inst_name": "string"},
                    attrs=[{"attr_id": "os_type", "attr_name": "操作系统", "attr_type": "string"}],
                )
            ],
            analysis_mode="distribution",
            permission_map={"1": {}},
            group_by="host.os_type",
        )


def test_instance_modes_reject_params_they_do_not_use():
    common = {
        "models": [
            _instance_model(
                attr_types={"inst_name": "string", "cpu": "number"},
                attrs=[{"attr_id": "cpu", "attr_name": "CPU", "attr_type": "number"}],
            )
        ],
        "permission_map": {"1": {}},
    }
    with pytest.raises(GenericQueryError, match="不支持分布属性、排序"):
        query_instances(**common, analysis_mode="count", group_by="host.cpu", order="inst_name")
    with pytest.raises(GenericQueryError, match="不支持聚合属性、聚合方式"):
        query_instances(**common, analysis_mode="detail", aggregate_field="host.cpu", aggregate_op="sum", columns=["host.cpu"])
    with pytest.raises(GenericQueryError, match="不支持分布属性"):
        query_instances(**common, analysis_mode="aggregate", group_by="host.cpu", aggregate_field="host.cpu", aggregate_op="sum")


def test_distribution_return_limit_rejects_page(monkeypatch):
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.group_instance_counts",
        lambda *args, **kwargs: {"Linux": 3, "Windows": 1, "Other": 2},
    )
    common = {
        "models": [
            _instance_model(
                attr_types={"os_type": "string"},
                attrs=[{"attr_id": "os_type", "attr_name": "操作系统", "attr_type": "string"}],
            )
        ],
        "permission_map": {"1": {}},
        "group_by": "host.os_type",
    }
    limited = query_instances(**common, analysis_mode="distribution", page_size=2)
    assert [item["host.os_type"] for item in limited["items"]] == ["Linux", "Other"]
    assert limited["count"] == 3
    assert limited["page"] == 1
    assert limited["page_size"] == 2
    with pytest.raises(GenericQueryError, match="不支持页码"):
        query_instances(**common, analysis_mode="distribution", page=2, page_size=1)
    with pytest.raises(GenericQueryError, match="不支持分页"):
        query_instances(
            models=[_instance_model(attr_types={"os_type": "string"})],
            analysis_mode="count",
            permission_map={"1": {}},
            page_size=1,
        )

    graph_result = {
        "pair_count": 3,
        "groups": [
            {"start_uuid": "b", "start_name": "B", "relation_count": 2},
            {"start_uuid": "a", "start_name": "A", "relation_count": 1},
        ],
        "pairs": [],
    }
    hop = query_one_hop_relations(
        analysis_mode="distribution",
        graph_result=graph_result,
        page_size=1,
    )
    assert [item["start_name"] for item in hop["items"]] == ["B"]
    assert hop["count"] == 2
    assert hop["page_size"] == 1
    with pytest.raises(GenericQueryError, match="不支持页码"):
        query_one_hop_relations(
            analysis_mode="distribution",
            graph_result=graph_result,
            page=2,
        )


def test_instance_aggregate_distinguishes_zero_from_empty(monkeypatch):
    spec = _instance_model(
        attr_types={"cpu": "number", "inst_name": "string"},
        attrs=[{"attr_id": "cpu", "attr_name": "CPU", "attr_type": "number"}],
    )
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.aggregate_numeric",
        lambda field, aggregation, params, permission_map, **_kwargs: {"value": 0, "scanned": 2, "valued": 2},
    )
    zero = query_instances(
        models=[spec],
        analysis_mode="aggregate",
        permission_map={"1": {}},
        aggregate_field="host.cpu",
        aggregate_op="sum",
    )
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.aggregate_numeric",
        lambda field, aggregation, params, permission_map, **_kwargs: {"value": None, "scanned": 0, "valued": 0},
    )
    empty = query_instances(
        models=[spec],
        analysis_mode="aggregate",
        permission_map={"1": {}},
        aggregate_field="host.cpu",
        aggregate_op="sum",
    )
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.aggregate_numeric",
        lambda field, aggregation, params, permission_map, **_kwargs: {"value": 0, "scanned": 2, "valued": 0},
    )
    missing = query_instances(
        models=[spec],
        analysis_mode="aggregate",
        permission_map={"1": {}},
        aggregate_field="host.cpu",
        aggregate_op="sum",
    )

    assert zero["status"] == "ok"
    assert zero["aggregate_value"] == 0
    assert zero["aggregate_field"] == "host.cpu"
    assert zero["valued_count"] == 2
    assert empty["status"] == "empty"
    assert empty["aggregate_value"] is None
    assert empty["scanned_count"] == 0
    assert empty["fields"][0]["key"] == "aggregate_value"
    assert missing["status"] == "missing"
    assert missing["aggregate_value"] is None
    assert missing["scanned_count"] == 2
    assert missing["valued_count"] == 0


def test_one_hop_counts_each_start_without_merging_a_shared_end():
    payload = query_one_hop_relations(
        analysis_mode="distribution",
        graph_result={
            "groups": [
                {"start_uuid": "app-a", "start_name": "应用甲", "relation_count": 2},
                {"start_uuid": "app-b", "start_name": "应用乙", "relation_count": 1},
            ],
        },
    )
    total = query_one_hop_relations(
        analysis_mode="count",
        graph_result={"pair_count": 3},
    )

    assert [item["start_name"] for item in payload["items"]] == ["应用甲", "应用乙"]
    assert [item["relation_count"] for item in payload["items"]] == [2, 1]
    assert sum(item["relation_count"] for item in payload["items"]) == total["relation_count"] == 3
    assert payload["fields"][0]["key"] == "start_name"
    assert "不合并" in total["aggregation"]


def test_one_hop_rank_stops_before_the_heavy_query_when_groups_exceed_the_cap():
    from types import SimpleNamespace

    from apps.cmdb.services.generic_query_graph import _rank_starts

    queries = []

    class Record:
        def __init__(self, payload):
            self.payload = payload

        def data(self):
            return self.payload

    class Session:
        def begin_transaction(self, timeout=None):
            return self

        def run(self, query, params):
            queries.append(query)
            return [Record({"group_count": STAT_GROUP_MAX + 1})]

        def commit(self):
            return None

        def rollback(self):
            return None

    result = _rank_starts(SimpleNamespace(session=Session()), "(s)-[r]->(t)", "s.model_id = $model", {}, 1)
    assert result == {"group_count": STAT_GROUP_MAX + 1, "groups": []}
    assert len(queries) == 1
    assert "relation_count" not in queries[0]


def test_numeric_where_rejects_empty_permission_even_with_a_model_filter():
    from apps.cmdb.services.generic_query_graph import GenericQueryGraphError, _where_clause

    class Client:
        def format_search_params(self, params, param_type, param_collector, alias):
            if params and params[0].get("field") == "model_id":
                return "n.model_id = $model", {}
            return "", {}

    with pytest.raises(GenericQueryGraphError, match="权限范围"):
        _where_clause(Client(), [{"field": "model_id", "type": "str=", "value": "host"}], {}, "n")


def test_one_hop_count_returns_a_large_total_and_full_ranking_stays_capped():
    total = query_one_hop_relations(analysis_mode="count", graph_result={"pair_count": 10000})
    assert total["relation_count"] == 10000
    detail = query_one_hop_relations(
        analysis_mode="detail",
        graph_result={
            "pair_count": 10000,
            "paged": True,
            "pairs": [
                {
                    "start_uuid": "s",
                    "start_name": "应用甲",
                    "start_model_id": "app",
                    "end_uuid": "e",
                    "end_name": "主机甲",
                    "end_model_id": "host",
                }
            ],
        },
        page=2,
        page_size=20,
    )
    assert detail["count"] == 10000
    assert detail["page"] == 2
    assert detail["items"][0]["start_name"] == "应用甲"
    with pytest.raises(GenericQueryError, match=str(STAT_GROUP_MAX)):
        query_one_hop_relations(
            analysis_mode="distribution",
            graph_result={"group_count": STAT_GROUP_MAX + 1, "groups": []},
        )
    with pytest.raises(GenericQueryError, match=str(STAT_GROUP_MAX)):
        query_one_hop_relations(
            analysis_mode="distribution",
            graph_result={
                "group_count": STAT_GROUP_MAX + 1,
                "groups": [{"start_uuid": "a", "start_name": "A", "relation_count": 9}],
            },
            page_size=1,
        )


def test_specified_model_without_visibility_is_forbidden():
    with pytest.raises(GenericQueryError, match="无权访问") as exc:
        query_models(
            models=[_model("host", "主机", "compute", "计算")],
            instance_counts={"host": 1},
            analysis_mode="detail",
            model_ids=["missing"],
        )
    assert exc.value.status == "forbidden"


def test_generic_query_handlers_accept_unknown_kwargs(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_models

    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._visible_models",
        lambda user_info: (
            [_model("host", "主机", "compute", "计算")],
            {"1": {}},
            {"compute": "计算"},
        ),
    )
    monkeypatch.setattr("apps.cmdb.nats.generic_query.count_by_attr", lambda *args, **kwargs: {"host": 0})

    result = query_cmdb_models(
        analysis_mode="count",
        user_info={"user": "demo"},
        unexpected="kept-out-of-the-query",
    )

    assert result["result"] is True
    assert result["data"]["model_count"] == 1
    assert "unexpected" not in result["data"]

    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._visible_models",
        lambda user_info: (
            [
                _model("low", "低", "compute", "计算"),
                _model("high", "高", "compute", "计算"),
            ],
            {"1": {}},
            {"compute": "计算"},
        ),
    )
    monkeypatch.setattr("apps.cmdb.nats.generic_query.count_by_attr", lambda *args, **kwargs: {"low": 1, "high": 4})
    ranked = query_cmdb_models(analysis_mode="distribution", page_size=1, user_info={"user": "demo"})
    untouched = query_cmdb_models(analysis_mode="distribution", user_info={"user": "demo"})
    assert [item["model_id"] for item in ranked["data"]["items"]] == ["high"]
    assert [item["model_id"] for item in untouched["data"]["items"]] == ["high", "low"]


def test_one_hop_uses_fixed_order():
    ranked = query_one_hop_relations(
        analysis_mode="distribution",
        graph_result={
            "groups": [
                {"start_uuid": "b", "start_name": "B", "relation_count": 1},
                {"start_uuid": "a", "start_name": "A", "relation_count": 2},
            ],
        },
    )
    detail = query_one_hop_relations(
        analysis_mode="detail",
        graph_result={
            "pairs": [
                {"start_uuid": "s2", "start_name": "b", "end_uuid": "e1", "end_name": "host-a"},
                {"start_uuid": "s1", "start_name": "a", "end_uuid": "e2", "end_name": "host-b"},
                {"start_uuid": "s1", "start_name": "a", "end_uuid": "e1", "end_name": "host-a"},
            ],
        },
        page_size=10,
    )
    assert [item["start_name"] for item in ranked["items"]] == ["A", "B"]
    assert [item["relation_count"] for item in ranked["items"]] == [2, 1]
    assert [(item["start_name"], item["end_name"]) for item in detail["items"]] == [
        ("a", "host-a"),
        ("a", "host-b"),
        ("b", "host-a"),
    ]


def test_instance_detail_validates_sort_field_before_instance_list(monkeypatch):
    called = {}

    def fake_scan(*args, **kwargs):
        called["scanned"] = True
        return [{"inst_name": "a", "inst_uuid": "u", "model_id": "host"}]

    monkeypatch.setattr("apps.cmdb.services.generic_query.scan_instance_rows", fake_scan)
    with pytest.raises(GenericQueryError, match="不支持的排序字段"):
        query_instances(
            models=[_instance_model(attr_types={"inst_name": "string", "os-type": "string"})],
            analysis_mode="detail",
            permission_map={"1": {"inst_names": []}},
            order="os-type",
        )
    assert called == {}

    listed = query_instances(
        models=[_instance_model()],
        analysis_mode="detail",
        permission_map={"1": {"inst_names": []}},
        order="-inst_name",
    )
    assert called["scanned"] is True
    assert listed["items"][0]["inst_name"] == "a"
    assert listed["items"][0]["model_id"] == "host"


def test_one_hop_filters_endpoints_in_graph_and_fails_closed(monkeypatch):
    from apps.cmdb.graph.falkordb import FalkorDBClient
    from apps.cmdb.graph.format_type import ParameterCollector
    from apps.cmdb.services.generic_query_graph import GenericQueryGraphError, query_one_hop

    queries = []

    class Client:
        ENABLE_PARAMETERIZATION = True
        _param_collector = ParameterCollector()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def format_search_params(self, *args, **kwargs):
            return FalkorDBClient.format_search_params(self, *args, **kwargs)

    def fake_run(_client, query, params):
        queries.append((query, dict(params)))
        if "pair_count" in query:
            return [{"pair_count": 1}]
        return [
            {
                "start_uuid": "s1",
                "start_name": "起点",
                "start_model_id": "host",
                "end_uuid": "visible",
                "end_name": "可见",
                "end_model_id": "app",
            }
        ]

    monkeypatch.setattr("apps.cmdb.services.generic_query_graph.GraphClient", Client)
    monkeypatch.setattr("apps.cmdb.services.generic_query_graph._run", fake_run)

    result = query_one_hop(
        start_model_id="host",
        model_asst_id="host_belong_app",
        direction="out",
        end_model_id="app",
        permission_map={1: {"inst_names": ["可见"]}},
        part="detail",
        limit=20,
    )
    assert result["pair_count"] == 1
    assert result["pairs"][0]["end_name"] == "可见"
    assert result["paged"] is True
    assert queries
    for query, params in queries:
        assert "s.model_id = $start_model_id" in query
        assert "s.inst_name" in query
        assert "t.inst_name" in query
        assert "organization" in query
        assert ["可见"] in params.values()
        assert [1] in params.values()
    assert "ORDER BY start_name ASC, end_name ASC, start_uuid ASC, end_uuid ASC" in queries[-1][0]
    assert "SKIP 0 LIMIT 20" in queries[-1][0]

    counted = []

    def fake_count(_client, query, params):
        counted.append(query)
        return [{"pair_count": 10000}]

    monkeypatch.setattr("apps.cmdb.services.generic_query_graph._run", fake_count)
    total = query_one_hop(
        start_model_id="host",
        model_asst_id="host_belong_app",
        direction="out",
        end_model_id="app",
        permission_map={1: {"inst_names": []}},
        part="count",
    )
    assert total == {"pair_count": 10000}
    assert len(counted) == 1
    assert "s.organization" in counted[0] or "s." in counted[0]
    assert "organization" in counted[0]

    with pytest.raises(GenericQueryGraphError, match="权限范围"):
        query_one_hop(
            start_model_id="host",
            model_asst_id="host_belong_app",
            direction="out",
            end_model_id="app",
            permission_map={},
            part="count",
        )


def test_unsupported_filters_fail_instead_of_being_dropped(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_instances, query_cmdb_models

    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._visible_models",
        lambda user_info: ([_model("host", "主机", "compute", "计算")], {"1": {"inst_names": []}}, {"compute": "计算"}),
    )
    dropped = query_cmdb_models(analysis_mode="count", user_info={"user": "demo"}, filters={"field": "model_id"})
    assert dropped["result"] is False
    assert "filters" in dropped["message"]

    invalid = query_cmdb_instances(
        model_id="host",
        analysis_mode="count",
        user_info={"user": "demo"},
        filters="not-a-group",
    )
    assert invalid["result"] is False
    assert "条件过滤" in invalid["message"]


def test_attribute_operators_and_or_group_compile():
    from apps.cmdb.services.generic_query import compile_attribute_conditions

    types = {"inst_name": "string", "cpu": "number", "os_type": "enum"}
    logic, conditions = compile_attribute_conditions(
        types,
        None,
        None,
        None,
        {
            "logic": "OR",
            "items": [
                {"field": "inst_name", "op": "contains", "value": "web"},
                {"field": "inst_name", "op": "empty"},
                {"field": "cpu", "op": "gte", "value": "4"},
                {"field": "os_type", "op": "in", "value": "Linux,Windows"},
            ],
        },
    )
    assert logic == "OR"
    assert conditions == [
        {"field": "inst_name", "type": "str*", "value": "web"},
        {"field": "inst_name", "type": "empty"},
        {"field": "cpu", "type": "int>=", "value": 4},
        {"field": "os_type", "type": "list_any[]", "value": ["Linux", "Windows"]},
    ]
    eq_logic, eq_conditions = compile_attribute_conditions(
        types,
        None,
        None,
        None,
        {"logic": "AND", "items": [{"field": "os_type", "op": "eq", "value": "1"}]},
    )
    assert (eq_logic, eq_conditions) == ("AND", [{"field": "os_type", "type": "list_any[]", "value": ["1"]}])
    ne_logic, ne_conditions = compile_attribute_conditions(
        types,
        None,
        None,
        None,
        {"logic": "AND", "items": [{"field": "os_type", "op": "ne", "value": "1"}]},
    )
    assert (ne_logic, ne_conditions) == ("AND", [{"field": "os_type", "type": "list_none[]", "value": ["1"]}])
    with pytest.raises(GenericQueryError, match="运算符不受支持"):
        compile_attribute_conditions(types, "inst_name", "in", "web", None)
    with pytest.raises(GenericQueryError, match="旧字段和 OR"):
        compile_attribute_conditions(
            types,
            "inst_name",
            "eq",
            "web",
            {"logic": "OR", "items": [{"field": "cpu", "op": "gt", "value": 1}]},
        )
    empty_logic, empty_items = compile_attribute_conditions(types, None, None, None, {"logic": "OR", "items": []})
    assert (empty_logic, empty_items) == ("OR", [])


def test_one_hop_or_group_stays_parenthesized_with_permission(monkeypatch):
    from apps.cmdb.graph.falkordb import FalkorDBClient
    from apps.cmdb.graph.format_type import ParameterCollector
    from apps.cmdb.services.generic_query_graph import query_one_hop

    queries = []

    class Client:
        ENABLE_PARAMETERIZATION = True
        _param_collector = ParameterCollector()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def format_search_params(self, *args, **kwargs):
            return FalkorDBClient.format_search_params(self, *args, **kwargs)

    monkeypatch.setattr("apps.cmdb.services.generic_query_graph.GraphClient", Client)
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query_graph._run",
        lambda _client, query, params: queries.append((query, dict(params))) or [{"pair_count": 0}],
    )
    query_one_hop(
        start_model_id="host",
        model_asst_id="host_belong_app",
        direction="out",
        end_model_id="app",
        permission_map={1: {"inst_names": ["可见"]}},
        end_conditions=[
            {"field": "inst_name", "type": "str=", "value": "公开"},
            {"field": "inst_name", "type": "str=", "value": "内部"},
        ],
        end_logic="OR",
        part="count",
    )
    query, params = queries[0]
    assert re.search(r"\(t\.inst_name = \$str\d+ OR t\.inst_name = \$str\d+\)", query)
    assert "organization" in query
    assert query.index("organization") < query.index(" OR t.inst_name")
    assert "公开" in params.values()
    assert "内部" in params.values()


def test_one_hop_ranks_starts_in_the_graph(monkeypatch):
    from apps.cmdb.graph.falkordb import FalkorDBClient
    from apps.cmdb.graph.format_type import ParameterCollector
    from apps.cmdb.services.generic_query_graph import query_one_hop

    queries = []

    class Client:
        ENABLE_PARAMETERIZATION = True
        _param_collector = ParameterCollector()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def format_search_params(self, *args, **kwargs):
            return FalkorDBClient.format_search_params(self, *args, **kwargs)

    def fake_run(_client, query, params):
        queries.append(query)
        if "group_count" in query:
            return [{"group_count": 2}]
        return [{"start_uuid": "app-a", "start_name": "应用甲", "relation_count": 4}]

    monkeypatch.setattr("apps.cmdb.services.generic_query_graph.GraphClient", Client)
    monkeypatch.setattr("apps.cmdb.services.generic_query_graph._run", fake_run)
    ranked = query_one_hop(
        start_model_id="app",
        model_asst_id="application_run_host",
        direction="out",
        end_model_id="host",
        permission_map={1: {"inst_names": []}},
        part="distribution",
        limit=1,
    )
    assert ranked["group_count"] == 2
    assert ranked["groups"][0]["start_uuid"] == "app-a"
    group_query = queries[-1]
    assert "count(end_uuid) AS relation_count" in group_query
    assert "WITH start_uuid, start_name, count(end_uuid) AS relation_count" in group_query
    assert "ORDER BY relation_count DESC, start_uuid ASC" in group_query
    assert "SKIP 0 LIMIT 20" not in group_query
    assert "LIMIT 1" in group_query
    assert "s.model_id = $start_model_id" in group_query
    assert "t.model_id = $end_model_id" in group_query


def _visible_cmdb_models():
    return (
        [
            _model("host", "主机", "compute", "计算"),
            _model("app", "应用", "biz", "业务"),
            _model("room", "机房", "space", "空间"),
        ],
        {"1": {"inst_names": []}},
        {"compute": "计算", "biz": "业务", "space": "空间"},
    )


def test_model_options_list_only_the_selected_classification(monkeypatch):
    from apps.cmdb.nats.generic_query import list_cmdb_model_options

    monkeypatch.setattr("apps.cmdb.nats.generic_query._visible_models", lambda user_info: _visible_cmdb_models())
    listed = list_cmdb_model_options(classification_id="compute", user_info={"user": "demo"})
    assert listed["result"] is True
    assert [item["model_id"] for item in listed["data"]] == ["host"]
    hidden = list_cmdb_model_options(classification_id="secret", user_info={"user": "demo"})
    assert hidden["result"] is False
    assert hidden["data"]["status"] == "forbidden"


def test_instance_classification_does_not_replace_model_permission(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_instances

    monkeypatch.setattr("apps.cmdb.nats.generic_query._visible_models", lambda user_info: _visible_cmdb_models())
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._load_model_attrs",
        lambda model_id, user_info: [{"attr_id": "inst_name", "attr_name": "实例名称", "attr_type": "str"}],
    )
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.query_instances",
        lambda **kwargs: {"structure": "value", "status": "ok", "value": 1, "unit": "个", "aggregation": "实例计数"},
    )

    matched = query_cmdb_instances(
        model_id="host",
        classification_id="compute",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert matched["result"] is True
    assert "column_fields" not in matched["data"]

    empty_classification = query_cmdb_instances(
        model_id="host",
        classification_id="",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert empty_classification["result"] is True

    mismatch = query_cmdb_instances(
        model_id="host",
        classification_id="space",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert mismatch["result"] is False
    assert "分类" in mismatch["message"]

    forbidden = query_cmdb_instances(
        model_id="secret",
        classification_id="compute",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert forbidden["result"] is False
    assert forbidden["data"]["status"] == "forbidden"


def test_one_hop_loads_associations_after_classification_matches(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_one_hop

    listed = []
    monkeypatch.setattr("apps.cmdb.nats.generic_query._visible_models", lambda user_info: _visible_cmdb_models())
    monkeypatch.setattr("apps.cmdb.nats.generic_query._attr_types", lambda model_id, user_info: {"inst_name": "string"})
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.list_model_association_options",
        lambda language, model_id: listed.append(model_id)
        or [
            {
                "model_asst_id": "host_belong_app",
                "src_model_id": "host",
                "dst_model_id": "app",
                "label": "属于",
            }
        ],
    )
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.query_one_hop",
        lambda **kwargs: {"pair_count": 0, "groups": [], "pairs": []},
    )

    mismatch = query_cmdb_one_hop(
        start_model_id="host",
        classification_id="space",
        model_asst_id="host_belong_app",
        direction="out",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert mismatch["result"] is False
    assert listed == []

    loaded = query_cmdb_one_hop(
        start_model_id="host",
        classification_id="compute",
        model_asst_id="host_belong_app",
        direction="out",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert loaded["result"] is True
    assert listed == ["host"]


def test_one_hop_direction_follows_the_side_where_the_start_sits(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_one_hop

    calls = []
    monkeypatch.setattr("apps.cmdb.nats.generic_query._visible_models", lambda user_info: _visible_cmdb_models())
    monkeypatch.setattr("apps.cmdb.nats.generic_query._attr_types", lambda model_id, user_info: {"inst_name": "string"})
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.query_one_hop",
        lambda **kwargs: calls.append(kwargs) or {"pair_count": 0, "groups": [], "pairs": []},
    )

    def associations(language, model_id):
        del language, model_id
        return [
            {
                "model_asst_id": "application_run_host",
                "src_model_id": "app",
                "dst_model_id": "host",
            }
        ]

    monkeypatch.setattr("apps.cmdb.nats.generic_query.list_model_association_options", associations)
    inward = query_cmdb_one_hop(
        start_model_id="host",
        classification_id="compute",
        model_asst_id="application_run_host",
        direction="out",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert inward["result"] is True
    assert calls[-1]["direction"] == "in"
    assert calls[-1]["end_model_id"] == "app"

    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.list_model_association_options",
        lambda language, model_id: [
            {
                "model_asst_id": "application_run_host",
                "src_model_id": "host",
                "dst_model_id": "app",
            }
        ],
    )
    outward = query_cmdb_one_hop(
        start_model_id="host",
        classification_id="compute",
        model_asst_id="application_run_host",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert outward["result"] is True
    assert calls[-1]["direction"] == "out"
    assert calls[-1]["end_model_id"] == "app"

    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.list_model_association_options",
        lambda language, model_id: [
            {
                "model_asst_id": "host_link_host",
                "src_model_id": "host",
                "dst_model_id": "host",
            }
        ],
    )
    same_side = query_cmdb_one_hop(
        start_model_id="host",
        classification_id="compute",
        model_asst_id="host_link_host",
        analysis_mode="count",
        user_info={"user": "demo"},
    )
    assert same_side["result"] is False
    assert "两端相同" in same_side["message"]


def test_instance_detail_hides_password_and_describes_business_columns(monkeypatch):
    captured = {}

    def fake_scan(*args, **kwargs):
        captured["fields"] = kwargs.get("fields") or args[2]
        captured["limit"] = kwargs.get("limit")
        return [
            {
                "inst_name": "web-1",
                "inst_uuid": "uuid-1",
                "model_id": "host",
                "cpu": 0,
                "enabled": False,
                "status": "1",
                "status_display": "运行中",
                "organization": [7],
                "organization_display": "研发",
                "password": "secret-value",
                "password_display": "secret-display",
                "owner": "user-1",
            }
        ]

    monkeypatch.setattr("apps.cmdb.services.generic_query.scan_instance_rows", fake_scan)
    attrs = [
        {"attr_id": "cpu", "attr_name": "CPU", "attr_type": "int"},
        {"attr_id": "enabled", "attr_name": "是否启用", "attr_type": "bool"},
        {"attr_id": "status", "attr_name": "运行状态", "attr_type": "enum"},
        {"attr_id": "organization", "attr_name": "组织", "attr_type": "organization"},
        {"attr_id": "password", "attr_name": "密码", "attr_type": "pwd"},
        {"attr_id": "owner", "attr_name": "负责人", "attr_type": "user"},
    ]
    spec = _instance_model(
        attr_types={
            "inst_name": "str",
            "cpu": "int",
            "enabled": "bool",
            "status": "enum",
            "organization": "organization",
            "password": "pwd",
            "owner": "user",
        },
        attrs=attrs,
    )
    with pytest.raises(GenericQueryError, match="无权使用"):
        query_instances(
            models=[spec],
            analysis_mode="detail",
            permission_map={"1": {"inst_names": []}},
            columns=["host.password"],
        )
    payload = query_instances(
        models=[spec],
        analysis_mode="detail",
        permission_map={"1": {"inst_names": []}},
        columns=["host.cpu", "host.enabled", "host.status", "host.organization", "host.owner"],
        page=1,
        page_size=20,
    )
    row = payload["items"][0]
    assert row["host.cpu"] == 0
    assert row["host.enabled"] is False
    assert row["host.status"] == "1"
    assert row["host.status_display"] == "运行中"
    assert "password" not in row
    assert "host.password" not in row
    assert "_id" not in row
    assert "name" not in row
    assert captured["limit"] == SCAN_INSTANCE_MAX + 1
    assert "password" not in captured["fields"]

    fields = build_instance_column_fields(
        [
            {"attr_id": "inst_name", "attr_name": "实例名称", "attr_type": "str"},
            {"attr_id": "cpu", "attr_name": "CPU", "attr_type": "int"},
            {"attr_id": "status", "attr_name": "运行状态", "attr_type": "enum", "option": [{"id": "1", "name": "运行中"}, {"id": 0, "name": "停止"}]},
            {"attr_id": "status_display", "attr_name": "运行状态", "attr_type": "str", "is_display_field": True},
            {"attr_id": "password", "attr_name": "密码", "attr_type": "pwd"},
            {"attr_id": "password_display", "attr_name": "密码", "attr_type": "str", "is_display_field": True},
            {"attr_id": "inst_uuid", "attr_name": "实例标识", "attr_type": "str"},
            {"attr_id": "node_id", "attr_name": "节点", "attr_type": "str", "is_system_link": True},
        ],
        model_key="host",
    )
    by_key = {field["key"]: field for field in fields["fields"]}
    assert [field["key"] for field in fields["fields"] if field["default_visible"]][:2] == ["inst_name", "cpu"]
    assert by_key["inst_name"]["title"] == "实例名称"
    assert by_key["status"]["title"] == "运行状态"
    assert by_key["status"]["options"] == [{"value": "1", "label": "运行中"}, {"value": "0", "label": "停止"}]
    assert by_key["inst_uuid"]["default_visible"] is False
    assert by_key["node_id"]["default_visible"] is False
    assert "password" not in by_key
    assert "status_display" not in by_key
    assert "name" not in by_key
    assert "unit" not in by_key


def test_instance_detail_empty_page_stays_paged(monkeypatch):
    monkeypatch.setattr("apps.cmdb.services.generic_query.scan_instance_rows", lambda *args, **kwargs: [])
    payload = query_instances(
        models=[_instance_model(attr_types={"inst_name": "str", "status": "enum"})],
        analysis_mode="detail",
        permission_map={"1": {"inst_names": []}},
    )
    assert payload["items"] == []
    assert payload["status"] == "empty"
    assert payload["page_size"] == 20


def test_one_hop_detail_projects_both_sides_and_skips_protocol_columns():
    rows = project_one_hop_rows(
        [
            {
                "start_uuid": "s1",
                "start_name": "主机甲",
                "start_model_id": "host",
                "end_uuid": "e1",
                "end_name": "应用甲",
                "end_model_id": "app",
            }
        ],
        starts=[
            {
                "inst_uuid": "s1",
                "inst_name": "主机甲",
                "model_id": "host",
                "cpu": 0,
                "password": "secret",
                "password_display": "secret-display",
                "_id": 1,
            }
        ],
        ends=[
            {
                "inst_uuid": "e1",
                "inst_name": "应用甲",
                "model_id": "app",
                "status": "up",
                "status_display": "在线",
                "enabled": False,
            }
        ],
        start_attrs=[
            {"attr_id": "cpu", "attr_type": "int"},
            {"attr_id": "password", "attr_type": "pwd"},
        ],
        end_attrs=[
            {"attr_id": "status", "attr_type": "enum"},
            {"attr_id": "enabled", "attr_type": "bool"},
        ],
    )
    row = rows[0]
    assert row["start:cpu"] == 0
    assert row["end:enabled"] is False
    assert row["end:status_display"] == "在线"
    assert "password" not in row
    assert "start:password" not in row
    assert "start:password_display" not in row
    assert "_id" not in row
    assert "name" not in row
    columns = build_one_hop_column_fields(
        [
            {"attr_id": "inst_name", "attr_name": "实例名称", "attr_type": "str"},
            {"attr_id": "cpu", "attr_name": "CPU", "attr_type": "int"},
            {"attr_id": "password", "attr_name": "密码", "attr_type": "pwd"},
        ],
        [
            {"attr_id": "inst_name", "attr_name": "实例名称", "attr_type": "str"},
            {"attr_id": "status", "attr_name": "状态", "attr_type": "enum", "option": [{"id": "up", "name": "在线"}]},
        ],
        model_key="host|out|host_belong_app|app",
    )
    keys = [field["key"] for field in columns["fields"]]
    assert keys[:3] == ["start_name", "start:cpu", "end_name"]
    assert "end:status" in keys
    assert "name" not in keys
    assert "value" not in keys
    assert "unit" not in keys
    assert "aggregation" not in keys
    assert next(field for field in columns["fields"] if field["key"] == "start_uuid")["default_visible"] is False


def test_instance_detail_handler_attaches_model_columns_and_strips_password(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_instances

    monkeypatch.setattr("apps.cmdb.nats.generic_query._visible_models", lambda user_info: _visible_cmdb_models())
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._load_model_attrs",
        lambda model_id, user_info: [
            {"attr_id": "inst_name", "attr_name": "实例名称", "attr_type": "str"},
            {"attr_id": "status", "attr_name": "运行状态", "attr_type": "enum", "option": [{"id": "1", "name": "运行中"}]},
            {"attr_id": "password", "attr_name": "密码", "attr_type": "pwd"},
        ],
    )
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.scan_instance_rows",
        lambda *args, **kwargs: [
            {
                "inst_name": "web-1",
                "inst_uuid": "uuid-1",
                "model_id": "host",
                "status": "1",
                "status_display": "运行中",
                "password": "secret-value",
                "password_display": "secret-display",
                "cpu": 0,
            }
        ],
    )

    loaded = query_cmdb_instances(
        model_id="host",
        classification_id="compute",
        analysis_mode="detail",
        columns=["host.status"],
        user_info={"user": "demo"},
    )
    assert loaded["result"] is True
    row = loaded["data"]["items"][0]
    assert row["host.status"] == "1"
    assert "cpu" not in row
    assert "password" not in row
    assert "password_display" not in row
    assert "host.password" not in row
    assert "_id" not in row
    fields = {field["key"]: field for field in loaded["data"]["column_fields"]["fields"]}
    assert loaded["data"]["column_fields"]["model_key"] == "host"
    assert fields["host.status"]["title"] == "运行状态"
    assert "password" not in fields
    assert "host.password" not in fields
    assert loaded["data"]["page_size"] == 20


def test_one_hop_detail_handler_projects_business_columns(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_one_hop

    monkeypatch.setattr("apps.cmdb.nats.generic_query._visible_models", lambda user_info: _visible_cmdb_models())
    monkeypatch.setattr("apps.cmdb.nats.generic_query._attr_types", lambda model_id, user_info: {"inst_name": "string"})
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.list_model_association_options",
        lambda language, model_id: [
            {
                "model_asst_id": "host_belong_app",
                "src_model_id": "host",
                "dst_model_id": "app",
                "label": "属于",
            }
        ],
    )

    def attrs_for(model_id, user_info):
        if model_id == "host":
            return [
                {"attr_id": "inst_name", "attr_name": "实例名称", "attr_type": "str"},
                {"attr_id": "cpu", "attr_name": "CPU", "attr_type": "int"},
                {"attr_id": "password", "attr_name": "密码", "attr_type": "pwd"},
            ]
        return [
            {"attr_id": "inst_name", "attr_name": "实例名称", "attr_type": "str"},
            {"attr_id": "status", "attr_name": "状态", "attr_type": "enum", "option": [{"id": "up", "name": "在线"}]},
        ]

    monkeypatch.setattr("apps.cmdb.nats.generic_query._load_model_attrs", attrs_for)
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.query_one_hop",
        lambda **kwargs: {
            "pair_count": 1,
            "paged": True,
            "pairs": [
                {
                    "start_uuid": "s1",
                    "start_name": "主机甲",
                    "start_model_id": "host",
                    "end_uuid": "e1",
                    "end_name": "应用甲",
                    "end_model_id": "app",
                }
            ],
        },
    )

    def instances_for(uuids):
        rows = []
        for uuid in uuids:
            if uuid == "s1":
                rows.append(
                    {
                        "inst_uuid": "s1",
                        "inst_name": "主机甲",
                        "model_id": "host",
                        "cpu": 0,
                        "password": "secret",
                        "password_display": "secret-display",
                        "_id": 1,
                    }
                )
            if uuid == "e1":
                rows.append(
                    {
                        "inst_uuid": "e1",
                        "inst_name": "应用甲",
                        "model_id": "app",
                        "status": "up",
                        "status_display": "在线",
                        "enabled": False,
                    }
                )
        return rows

    monkeypatch.setattr("apps.cmdb.nats.generic_query.load_instances_by_uuids", instances_for)

    loaded = query_cmdb_one_hop(
        start_model_id="host",
        classification_id="compute",
        model_asst_id="host_belong_app",
        direction="out",
        analysis_mode="detail",
        user_info={"user": "demo"},
    )
    assert loaded["result"] is True
    row = loaded["data"]["items"][0]
    assert row["start:cpu"] == 0
    assert row["end:enabled"] is False
    assert row["end:status"] == "up"
    assert "start:password" not in row
    assert "start:password_display" not in row
    assert loaded["data"]["column_fields"]["model_key"] == "host|out|host_belong_app|app"
    keys = [field["key"] for field in loaded["data"]["column_fields"]["fields"]]
    assert "start:cpu" in keys
    assert "end:status" in keys
    assert "name" not in keys
    assert "unit" not in keys


def _scope_models():
    """假设数据：主机 100、虚机 50、路由 0。路由没有计数记录，按零实例保留。"""
    return [
        _model("host", "主机", "compute", "计算"),
        _model("vm", "虚机", "compute", "计算"),
        _model("router", "路由", "network", "网络"),
    ]


_SCOPE_COUNTS = {"host": 100, "vm": 50}


def test_model_count_permission_failure_is_not_reported_as_zero(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_models

    calls = {"count": 0}
    monkeypatch.setattr("apps.cmdb.nats.generic_query._resolve_nats_cmdb_language", lambda user_info: "zh-Hans")
    monkeypatch.setattr("apps.cmdb.nats.generic_query._build_nats_model_permission_map", lambda user_info: None)
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._build_nats_permission_map",
        lambda user_info: {"7": {"inst_names": ["visible-host"]}},
    )
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.count_by_attr",
        lambda *args, **kwargs: calls.__setitem__("count", calls["count"] + 1) or {},
    )

    denied = query_cmdb_models(
        analysis_mode="count",
        user_info={"user": "demo", "team": 7},
    )
    assert denied["result"] is False
    assert denied["data"] == {"status": "forbidden"}
    assert denied["message"] == "无权限"
    assert calls["count"] == 0

    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._build_nats_model_permission_map",
        lambda user_info: {"7": {}},
    )
    monkeypatch.setattr("apps.cmdb.nats.generic_query._build_nats_permission_map", lambda user_info: None)
    denied_instances = query_cmdb_models(
        analysis_mode="count",
        model_id="host",
        user_info={"user": "demo", "team": 7},
    )
    assert denied_instances["result"] is False
    assert denied_instances["data"] == {"status": "forbidden"}
    assert "value" not in denied_instances["data"]
    assert calls["count"] == 0


def test_handler_model_count_uses_full_permission_counts(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_models
    from apps.cmdb.services.generic_query import ensure_payload_limit

    calls = []
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._visible_models",
        lambda user_info: (
            _scope_models(),
            {"7": {"inst_names": ["visible-host"]}},
            {"compute": "计算", "network": "网络"},
        ),
    )

    def fake_count(group_by, params, permission_map, **kwargs):
        calls.append((group_by, list(params), permission_map))
        return dict(_SCOPE_COUNTS)

    monkeypatch.setattr("apps.cmdb.nats.generic_query.count_by_attr", fake_count)

    total = query_cmdb_models(analysis_mode="count", user_info={"user": "demo"})
    assert total["result"] is True
    assert total["data"]["model_count"] == 3
    assert total["data"]["aggregation"] == "模型计数"
    assert total["data"]["status"] == "ok"
    ensure_payload_limit(total["data"])
    assert calls == [("model_id", [], {"7": {"inst_names": ["visible-host"]}})]

    selected = query_cmdb_models(analysis_mode="count", model_id="host", user_info={"user": "demo"})
    assert selected["data"]["model_count"] == 1
    assert selected["data"]["aggregation"] == "模型计数"

    classified = query_cmdb_models(
        analysis_mode="count",
        classification_id="compute",
        user_info={"user": "demo"},
    )
    assert classified["data"]["model_count"] == 2

    paged = query_cmdb_models(
        analysis_mode="count",
        page=1,
        page_size=1,
        user_info={"user": "demo"},
    )
    assert paged["result"] is False
    assert "分页" in paged["message"]

    cleared = query_cmdb_models(
        analysis_mode="count",
        page="",
        page_size=None,
        user_info={"user": "demo"},
    )
    assert cleared["result"] is True
    assert cleared["data"]["model_count"] == 3

    detail = query_cmdb_models(
        analysis_mode="detail",
        page=1,
        page_size=1,
        user_info={"user": "demo"},
    )
    assert detail["result"] is True
    assert detail["data"]["count"] == 3
    assert detail["data"]["items"][0]["model_id"] == "router"
    assert list(detail["data"]["items"][0]) == list(DETAIL_COLUMNS)

    missing = query_cmdb_models(
        analysis_mode="count",
        model_id="secret",
        user_info={"user": "demo"},
    )
    assert missing["result"] is False
    assert missing["data"] == {"status": "forbidden"}

    unknown_class = query_cmdb_models(
        analysis_mode="count",
        classification_id="secret",
        user_info={"user": "demo"},
    )
    assert unknown_class["result"] is False
    assert unknown_class["data"] == {"status": "forbidden"}
    assert "value" not in unknown_class["data"]

    distribution = query_cmdb_models(
        analysis_mode="distribution",
        user_info={"user": "demo"},
    )
    assert distribution["result"] is True
    assert [item["model_id"] for item in distribution["data"]["items"]] == ["host", "vm", "router"]
    assert distribution["data"]["aggregation"] == "按模型统计权限内实例数，含零实例模型"


def test_http_resolution_reaches_handler_without_hidden_paging_or_cross_chart_params(monkeypatch):
    """假设数据主机 100、虚机 50、路由 0。HTTP 解析结果直接交给模型查询 handler。"""
    import json
    from pathlib import Path
    from types import SimpleNamespace

    from apps.cmdb.nats.generic_query import query_cmdb_models
    from apps.operation_analysis.views.datasource_view import _resolve_request_params

    seed_path = Path(__file__).resolve().parents[2] / "operation_analysis" / "support-files" / "source_api.json"
    sources = json.loads(seed_path.read_text(encoding="utf-8"))
    models = next(item for item in sources if item.get("rest_api") == "cmdb/query_cmdb_models")
    instance = SimpleNamespace(rest_api="cmdb/query_cmdb_models", params=models["params"])
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._visible_models",
        lambda user_info: (
            _scope_models(),
            {"7": {"inst_names": ["visible-host"]}},
            {"compute": "计算", "network": "网络"},
        ),
    )
    monkeypatch.setattr("apps.cmdb.nats.generic_query.count_by_attr", lambda *args, **kwargs: dict(_SCOPE_COUNTS))

    def run(request):
        resolved = _resolve_request_params(instance, request)
        return resolved, query_cmdb_models(user_info={"user": "demo"}, **resolved)

    distribution, distribution_result = run({"analysis_mode": "distribution"})
    assert "page" not in distribution
    assert "page_size" not in distribution
    assert distribution_result["result"] is True
    assert distribution_result["data"]["page"] == 1
    assert distribution_result["data"]["page_size"] == 3
    assert [item["model_id"] for item in distribution_result["data"]["items"]] == ["host", "vm", "router"]
    assert distribution_result["data"]["aggregation"] == "按模型统计权限内实例数，含零实例模型"

    counted, counted_result = run({"analysis_mode": "count"})
    assert "page" not in counted
    assert "page_size" not in counted
    assert counted_result["data"] == {
        "structure": "value",
        "status": "ok",
        "model_count": 3,
        "unit": "个",
        "aggregation": "模型计数",
        "fields": [{"key": "model_count", "title": "模型数", "value_type": "number", "role": "measure"}],
    }

    cleared, cleared_result = run({"analysis_mode": "count", "page": None, "page_size": ""})
    assert "page" not in cleared
    assert "page_size" not in cleared
    assert cleared_result["data"]["model_count"] == 3

    blocked, blocked_result = run({"analysis_mode": "count", "page": 1, "page_size": 10})
    assert blocked["page"] == 1
    assert blocked["page_size"] == 10
    assert blocked_result["result"] is False
    assert "分页" in blocked_result["message"]

    second, second_result = run({"analysis_mode": "distribution", "page": 2, "page_size": 10})
    assert second["page"] == 2
    assert second_result["result"] is False
    assert "页码" in second_result["message"]
    limited, limited_result = run({"analysis_mode": "distribution", "page_size": 10})
    assert "page" not in limited
    assert limited_result["result"] is True
    assert [item["model_id"] for item in limited_result["data"]["items"]] == ["host", "vm", "router"]
    assert limited_result["data"]["page_size"] == 10

    detail, detail_result = run({"analysis_mode": "detail"})
    assert "page" not in detail
    assert "page_size" not in detail
    assert detail_result["result"] is True
    assert detail_result["data"]["page"] == 1
    assert detail_result["data"]["page_size"] == 10
    assert detail_result["data"]["count"] == 3

    with pytest.raises(ValueError, match="未声明参数"):
        run({"analysis_mode": "count", "count_metric": "instance_total", "top_n": 10})


def test_instance_distribution_keeps_false_zero_and_null_buckets(monkeypatch):
    buckets = {}

    def grouped_counts(group_by, params, permission_map, condition_params=None, condition_logic="AND"):
        del group_by, params, permission_map, condition_params, condition_logic
        return buckets

    monkeypatch.setattr("apps.cmdb.services.generic_query.group_instance_counts", grouped_counts)

    def grouped(values, attr_type):
        buckets.clear()
        buckets.update(values)
        return query_instances(
            models=[
                _instance_model(
                    attr_types={"enabled": attr_type, "inst_name": "string"},
                    attrs=[{"attr_id": "enabled", "attr_name": "是否启用", "attr_type": attr_type}],
                )
            ],
            analysis_mode="distribution",
            permission_map={"1": {}},
            group_by="host.enabled",
        )

    boolean = grouped({False: 2, None: 3, "": 4}, "bool")
    dimension = next(field for field in boolean["fields"] if field.get("role") == "dimension")
    assert dimension["key"] == "host.enabled"
    assert dimension["title"] == "是否启用"
    assert dimension["value_type"] == "boolean"
    boolean_values = [item["host.enabled"] for item in boolean["items"]]
    assert any(value is False for value in boolean_values)
    assert None in boolean_values
    assert "" in boolean_values
    assert {item["instance_count"] for item in boolean["items"]} == {2, 3, 4}

    numeric = grouped({0: 1}, "int")
    assert numeric["items"][0]["host.enabled"] == 0
    assert numeric["items"][0]["host.enabled"] is not False

    with pytest.raises(GenericQueryError, match="不支持的排序字段"):
        query_instances(
            models=[
                _instance_model(
                    attr_types={"enabled": "bool", "inst_name": "string"},
                    attrs=[{"attr_id": "enabled", "attr_name": "是否启用", "attr_type": "bool"}],
                )
            ],
            analysis_mode="distribution",
            permission_map={"1": {}},
            group_by="host.enabled",
            order="name",
        )


def test_instance_distribution_names_enum_buckets(monkeypatch):
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.group_instance_counts",
        lambda *args, **kwargs: {1: 3, "1": 2, "9": 1, '["1", "3"]': 4, None: 5},
    )
    monkeypatch.setattr(
        "apps.cmdb.services.model.ModelManage.resolve_runtime_enum_options",
        lambda attr: [{"id": "1", "name": "已上线"}, {"id": "2", "name": "测试中"}, {"id": "3", "name": "停运"}],
    )

    payload = query_instances(
        models=[
            _instance_model(
                attr_types={"status": "enum", "inst_name": "string"},
                attrs=[{"attr_id": "status", "attr_name": "运行状态", "attr_type": "enum"}],
            )
        ],
        analysis_mode="distribution",
        permission_map={"1": {}},
        group_by="host.status",
    )

    by_status = {item["host.status"]: item["instance_count"] for item in payload["items"]}
    assert by_status == {"已上线": 5, "9": 1, "已上线, 停运": 4, None: 5}
    assert all(not isinstance(item["host.status"], int) for item in payload["items"])


def test_instance_distribution_handler_returns_enum_names(monkeypatch):
    from apps.cmdb.nats.generic_query import query_cmdb_instances

    monkeypatch.setattr("apps.cmdb.nats.generic_query._visible_models", lambda user_info: _visible_cmdb_models())
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._load_model_attrs",
        lambda model_id, user_info: [
            {
                "attr_id": "status",
                "attr_name": "运行状态",
                "attr_type": "enum",
                "option": [{"id": "1", "name": "已上线"}, {"id": "2", "name": "测试中"}],
            }
        ],
    )
    monkeypatch.setattr("apps.cmdb.services.generic_query.group_instance_counts", lambda *args, **kwargs: {1: 8})

    loaded = query_cmdb_instances(
        model_id="host",
        classification_id="compute",
        analysis_mode="distribution",
        group_by="host.status",
        user_info={"user": "demo"},
    )

    assert loaded["result"] is True
    assert loaded["data"]["items"] == [{"model_name": "主机", "model_id": "host", "host.status": "已上线", "instance_count": 8}]
    assert loaded["data"]["fields"][2]["title"] == "运行状态"


def test_group_declaration_keeps_attribute_title_and_type():
    from apps.cmdb.nats.generic_query import _group_declaration

    assert _group_declaration(
        [{"attr_id": "os_type", "attr_name": "操作系统", "attr_type": "enum"}],
        "os_type",
    ) == ("操作系统", "string")
    assert _group_declaration(
        [{"attr_id": "enabled", "attr_name": "是否启用", "attr_type": "bool"}],
        "enabled",
    ) == ("是否启用", "boolean")
    assert _group_declaration([], "inst_name") == ("实例名称", "string")


def test_one_hop_distribution_keeps_blank_start_name():
    payload = query_one_hop_relations(
        analysis_mode="distribution",
        graph_result={
            "groups": [{"start_uuid": "start-1", "relation_count": 2}],
        },
    )
    assert payload["items"] == [{"start_name": "", "start_uuid": "start-1", "relation_count": 2}]
    assert payload["fields"][1]["role"] == "identity"
    assert payload["fields"][2]["key"] == "relation_count"


def test_attr_options_can_follow_the_other_end_of_an_association(monkeypatch):
    from apps.cmdb.nats.generic_query import list_cmdb_attr_options

    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.list_model_association_options",
        lambda language, model_id: (
            [
                {"model_asst_id": "host_run_app", "src_model_id": "host", "dst_model_id": "app"},
            ]
            if str(model_id) == "host"
            else []
        ),
    )
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query._visible_models",
        lambda user_info: ([_model("app", "应用", "biz", "业务"), _model("host", "主机", "compute", "计算")], {}, {}),
    )

    def fake_attrs(model_id, language):
        del language
        if model_id == "app":
            return [
                {"attr_id": "name", "attr_name": "名称", "attr_type": "string"},
                {"attr_id": "status", "attr_name": "状态", "attr_type": "enum"},
            ]
        return [{"attr_id": "ip", "attr_name": "IP", "attr_type": "string"}]

    monkeypatch.setattr("apps.cmdb.nats.generic_query.ModelManage.search_model_attr", fake_attrs)
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.ModelManage.resolve_runtime_enum_options",
        lambda attr: [{"id": "1", "name": "已上线"}] if attr.get("attr_id") == "status" else [],
    )

    followed = list_cmdb_attr_options(start_model_id="host", model_asst_id="host_run_app", user_info={"user": "demo"})
    assert followed["result"] is True
    assert [item["attr_id"] for item in followed["data"]] == ["name", "status"]
    assert followed["data"][0]["value_type"] == "string"
    assert followed["data"][0]["options"] == []
    assert followed["data"][1]["value_type"] == "enum"
    assert followed["data"][1]["options"] == [{"value": "1", "label": "已上线"}]

    direct = list_cmdb_attr_options(model_id="host", start_model_id="host", model_asst_id="host_run_app", user_info={})
    assert [item["attr_id"] for item in direct["data"]] == ["ip"]

    missing = list_cmdb_attr_options(start_model_id="host", model_asst_id="missing", user_info={})
    assert missing == {"result": True, "data": [], "message": ""}

    empty = list_cmdb_attr_options(user_info={})
    assert empty["result"] is False
    assert "模型不能为空" in empty["message"]


def test_model_scope_is_explicit_models_or_classification_union():
    models = [
        _model("host", "主机", "compute", "计算"),
        _model("net", "网络", "compute", "计算"),
        _model("room", "机房", "space", "空间"),
    ]
    counts = {"host": 2, "net": 0, "room": 4}
    classified = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="count",
        classification_id=["compute", "space"],
    )
    explicit = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="count",
        classification_id=["compute"],
        model_ids=["host"],
    )
    both = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="detail",
        classification_id=["compute", "space"],
        model_ids=["host", "room"],
    )
    untouched = query_models(models=models, instance_counts=counts, analysis_mode="count")

    assert classified["model_count"] == 3
    assert explicit["model_count"] == 1
    assert [item["model_id"] for item in both["items"]] == ["room", "host"]
    assert untouched["model_count"] == 3
    with pytest.raises(GenericQueryError, match="不属于"):
        query_models(
            models=models,
            instance_counts=counts,
            analysis_mode="count",
            classification_id=["compute"],
            model_ids=["room"],
        )
    with pytest.raises(GenericQueryError, match="无权访问"):
        query_models(
            models=models,
            instance_counts=counts,
            analysis_mode="count",
            model_ids=["secret"],
        )
    many = [_model(f"m{index}", f"模型{index}", "compute", "计算") for index in range(51)]
    assert query_models(models=many, instance_counts={}, analysis_mode="count", classification_id="compute")["model_count"] == 51
    with pytest.raises(GenericQueryError, match="50"):
        query_models(
            models=many,
            instance_counts={},
            analysis_mode="count",
            model_ids=[item["model_id"] for item in many],
        )


def test_id_list_keeps_a_single_string_and_rejects_a_shared_filter():
    from apps.cmdb.services.generic_query import id_list, parse_model_filters

    assert id_list("host,app") == ["host,app"]
    assert id_list(["host", "host", "app"]) == ["host", "app"]
    assert parse_model_filters(None, ["host"]) == {"host": None}
    with pytest.raises(GenericQueryError, match="格式错误"):
        parse_model_filters({"logic": "OR", "items": []}, ["host"])
    with pytest.raises(GenericQueryError, match="未选模型"):
        parse_model_filters({"by_model": {"room": {"logic": "AND", "items": []}}}, ["host"])


def test_instance_union_uses_each_models_filter_and_fails_as_a_whole(monkeypatch):
    from apps.cmdb.services.generic_query_graph import GenericQueryGraphError

    seen = []

    def fake_count(params, permission_map, condition_params=None, condition_logic="AND"):
        del permission_map
        model_id = params[0]["value"]
        seen.append((model_id, condition_logic, condition_params))
        if model_id == "app":
            raise GenericQueryGraphError("查询超时")
        return 2

    monkeypatch.setattr("apps.cmdb.services.generic_query.count_instances", fake_count)
    host = _instance_model(
        attr_types={"inst_name": "string", "os_type": "string"},
        filters={"logic": "OR", "items": [{"field": "os_type", "op": "eq", "value": "Linux"}]},
    )
    app = _instance_model("app", "应用")
    with pytest.raises(GenericQueryError, match="查询超时"):
        query_instances(models=[host, app], analysis_mode="count", permission_map={"1": {}})
    assert seen[0][0] == "host"
    assert seen[0][1] == "OR"
    assert seen[1][0] == "app"

    def fake_ok(params, permission_map, condition_params=None, condition_logic="AND"):
        del permission_map, condition_logic
        return 3 if condition_params else 1

    monkeypatch.setattr("apps.cmdb.services.generic_query.count_instances", fake_ok)
    counted = query_instances(models=[host, app], analysis_mode="count", permission_map={"1": {}})
    assert counted["instance_count"] == 4
    with pytest.raises(GenericQueryError, match="20"):
        query_instances(
            models=[_instance_model(f"m{index}", f"模型{index}") for index in range(21)],
            analysis_mode="count",
            permission_map={"1": {}},
        )


def test_instance_detail_sorts_across_models_and_keeps_missing_cells_null(monkeypatch):
    def fake_scan(params, permission_map, fields, **kwargs):
        del permission_map, fields, kwargs
        model_id = params[0]["value"]
        if model_id == "host":
            return [
                {"inst_name": "b", "inst_uuid": "h2", "model_id": "host", "os_type": "Linux"},
                {"inst_name": None, "inst_uuid": "h1", "model_id": "host", "os_type": None},
            ]
        return [{"inst_name": "a", "inst_uuid": "a1", "model_id": "app"}]

    monkeypatch.setattr("apps.cmdb.services.generic_query.scan_instance_rows", fake_scan)
    host = _instance_model(
        attr_types={"inst_name": "string", "os_type": "string"},
        attrs=[{"attr_id": "os_type", "attr_name": "操作系统", "attr_type": "string"}],
    )
    app = _instance_model("app", "应用", attr_types={"inst_name": "string"})
    page = query_instances(
        models=[host, app],
        analysis_mode="detail",
        permission_map={"1": {}},
        columns=["host.os_type"],
        order="inst_name",
        page=1,
        page_size=2,
    )
    assert [item["inst_name"] for item in page["items"]] == ["a", "b"]
    assert page["count"] == 3
    assert page["items"][0]["host.os_type"] is None
    assert page["items"][1]["host.os_type"] == "Linux"
    assert page["column_fields"]["fields"][4]["title"] == "主机 · 操作系统"
    trailing = query_instances(
        models=[host, app],
        analysis_mode="detail",
        permission_map={"1": {}},
        columns=["host.os_type"],
        order="inst_name",
        page=2,
        page_size=2,
    )
    assert trailing["items"][0]["inst_name"] is None
    assert trailing["items"][0]["inst_uuid"] == "h1"


def test_instance_distribution_by_model_and_one_attribute(monkeypatch):
    counts = {"host": 2, "app": 5}

    def fake_count(params, permission_map, condition_params=None, condition_logic="AND"):
        del permission_map, condition_params, condition_logic
        return counts[params[0]["value"]]

    monkeypatch.setattr("apps.cmdb.services.generic_query.count_instances", fake_count)
    host = _instance_model("host", "主机")
    same_name = _instance_model("app", "主机")
    by_model = query_instances(
        models=[host, same_name],
        analysis_mode="distribution",
        permission_map={"1": {}},
        group_by="model",
    )
    assert [item["model_name"] for item in by_model["items"]] == ["主机（app）", "主机（host）"]
    assert [item["instance_count"] for item in by_model["items"]] == [5, 2]

    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.group_instance_counts",
        lambda *args, **kwargs: {"Linux": 2},
    )
    typed = _instance_model(
        attr_types={"os_type": "string", "inst_name": "string"},
        attrs=[{"attr_id": "os_type", "attr_name": "操作系统", "attr_type": "string"}],
    )
    other = _instance_model("app", "应用", filters={"logic": "AND", "items": [{"field": "inst_name", "op": "eq", "value": "a"}]})
    with pytest.raises(GenericQueryError, match="其他模型不参与"):
        query_instances(
            models=[typed, other],
            analysis_mode="distribution",
            permission_map={"1": {}},
            group_by="host.os_type",
        )
    with pytest.raises(GenericQueryError, match="跨模型"):
        query_instances(
            models=[typed, _instance_model("app", "应用")],
            analysis_mode="distribution",
            permission_map={"1": {}},
            group_by="os_type",
        )
    grouped = query_instances(
        models=[typed, _instance_model("app", "应用")],
        analysis_mode="distribution",
        permission_map={"1": {}},
        group_by="host.os_type",
    )
    assert grouped["items"][0]["host.os_type"] == "Linux"
    assert grouped["items"][0]["model_id"] == "host"
    assert "主机" in grouped["aggregation"]


def test_instance_reads_keep_permission_outside_or_and_use_timeout(monkeypatch):
    from apps.cmdb.graph.falkordb import FalkorDBClient
    from apps.cmdb.graph.format_type import ParameterCollector
    from apps.cmdb.services.generic_query_graph import (
        QUERY_TIMEOUT_MS,
        GenericQueryGraphError,
        aggregate_numeric,
        count_instances,
        group_instance_counts,
        scan_instance_rows,
    )

    queries = []

    class Client:
        ENABLE_PARAMETERIZATION = True
        _param_collector = ParameterCollector()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def format_search_params(self, *args, **kwargs):
            return FalkorDBClient.format_search_params(self, *args, **kwargs)

        def _execute_query(self, query, params=None, timeout=None):
            queries.append((query, timeout))
            name = "valued" if "AS valued" in query else "scanned"
            header = [(1, "bucket"), (1, "count")] if "AS bucket" in query else [(1, name)]
            row = ["Linux", 1] if "AS bucket" in query else [1]
            return SimpleResult(header, [row])

    class SimpleResult:
        def __init__(self, header, result_set):
            self.header = header
            self.result_set = result_set

    monkeypatch.setattr("apps.cmdb.services.generic_query_graph.GraphClient", Client)
    counted = count_instances(
        [{"field": "model_id", "type": "str=", "value": "host"}],
        {1: {"inst_names": ["可见"]}},
        [
            {"field": "inst_name", "type": "str=", "value": "公开"},
            {"field": "inst_name", "type": "str=", "value": "内部"},
        ],
        "OR",
    )
    assert counted == 1
    permission = {1: {"inst_names": ["可见"]}}
    base = [{"field": "model_id", "type": "str=", "value": "host"}]
    group_instance_counts("os_type", base, permission)
    scan_instance_rows(base, permission, ["inst_name"], limit=10)
    aggregate_numeric("cpu", "sum", base, permission)
    assert counted == 1
    query, timeout = queries[0]
    assert timeout == QUERY_TIMEOUT_MS
    assert {item[1] for item in queries} == {QUERY_TIMEOUT_MS}
    assert re.search(r"\(n\.inst_name = \$str\d+ OR n\.inst_name = \$str\d+\)", query)
    assert "organization" in query
    assert query.index("organization") > query.index(" OR n.inst_name")
    with pytest.raises(GenericQueryGraphError, match="权限范围"):
        count_instances(
            [{"field": "model_id", "type": "str=", "value": "host"}],
            {},
            [{"field": "inst_name", "type": "str=", "value": "公开"}],
            "OR",
        )


def test_model_options_union_and_attr_labels(monkeypatch):
    from apps.cmdb.nats.generic_query import list_cmdb_attr_options, list_cmdb_model_options, query_cmdb_models

    monkeypatch.setattr("apps.cmdb.nats.generic_query._visible_models", lambda user_info: _visible_cmdb_models())
    monkeypatch.setattr("apps.cmdb.services.generic_query_graph.count_by_attr", lambda *args, **kwargs: {})
    unknown = query_cmdb_models(classification_id=["compute", "missing"], analysis_mode="count", user_info={"user": "demo"})
    assert unknown["result"] is False
    assert unknown["data"]["status"] == "forbidden"

    listed = list_cmdb_model_options(classification_id=["biz", "compute"], user_info={"user": "demo"})
    assert [item["model_id"] for item in listed["data"]] == ["host", "app"]
    assert listed["data"][0]["classification_name"] == "计算"
    everything = list_cmdb_model_options(classification_id=[], user_info={"user": "demo"})
    assert [item["model_id"] for item in everything["data"]] == ["host", "app", "room"]

    def fake_attrs(model_id, user_info):
        del user_info
        name = "CPU" if model_id == "host" else "端口"
        attr_id = "cpu" if model_id == "host" else "port"
        attr_type = "int" if model_id == "host" else "string"
        return [{"attr_id": attr_id, "attr_name": name, "attr_type": attr_type}]

    monkeypatch.setattr("apps.cmdb.nats.generic_query._load_model_attrs", fake_attrs)
    single = list_cmdb_attr_options(model_id="host", user_info={"user": "demo"})
    assert single["data"][0]["option_label"] == "CPU"
    assert single["data"][0]["field_key"] == "host.cpu"
    many = list_cmdb_attr_options(
        model_id=["host", "app"],
        include_model_bucket=True,
        user_info={"user": "demo"},
    )
    assert many["data"][0]["field_key"] == "model"
    assert [item["option_label"] for item in many["data"][1:]] == ["主机 · CPU", "应用 · 端口"]
    numeric = list_cmdb_attr_options(
        model_id=["host", "app"],
        include_model_bucket=True,
        value_type="number",
        user_info={"user": "demo"},
    )
    assert [item["field_key"] for item in numeric["data"]] == ["host.cpu"]
