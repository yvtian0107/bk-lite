"""CMDB 通用查询的统计口径、上限和空结果。"""

import pytest

from apps.cmdb.services.generic_query import GenericQueryError, query_instances, query_models, query_one_hop_relations
from apps.cmdb.services.generic_query_columns import build_instance_column_fields, build_one_hop_column_fields, project_one_hop_rows
from apps.cmdb.services.generic_query_limits import DETAIL_PAGE_SIZE_MAX, ONE_HOP_RESULT_MAX, ONE_HOP_START_MAX, SCAN_INSTANCE_MAX, STAT_GROUP_MAX


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
    assert payload["page_size"] == 10
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


def test_model_distribution_counts_everything_then_pages():
    models = [_model(f"m{index:02d}", f"模型{index:02d}", "compute", "计算") for index in range(12)]
    counts = {model["model_id"]: 100 - index for index, model in enumerate(models)}
    first = query_models(models=models, instance_counts=counts, analysis_mode="distribution")
    second = query_models(models=models, instance_counts=counts, analysis_mode="distribution", page=2, page_size=10)
    blank = query_models(models=models, instance_counts=counts, analysis_mode="distribution", page=3, page_size=10)
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
    assert first["page_size"] == 10
    assert [item["model_id"] for item in first["items"]] == [f"m{index:02d}" for index in range(10)]
    assert [item["model_id"] for item in second["items"]] == ["m10", "m11"]
    assert second["count"] == 12
    assert blank["items"] == []
    assert blank["status"] == "empty"
    assert blank["count"] == 12
    assert blank["page"] == 3
    assert [(item["model_id"], item["instance_count"]) for item in short["items"]] == [("m00", 2), ("m02", 1), ("m01", 0)]
    assert blank["fields"][2]["role"] == "identity"
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


def test_instance_count_distribution_and_missing_model(monkeypatch):
    def fake_count(group_by, params, permission_map, **_kwargs):
        assert permission_map == {"1": {}}
        assert params[0]["value"] == "host"
        if group_by == "model_id":
            return {"host": 4}
        assert group_by == "os_type"
        return {"Linux": 3, "Windows": 1}

    monkeypatch.setattr("apps.cmdb.services.generic_query.count_by_attr", fake_count)
    attrs = {"inst_name": "string", "os_type": "string"}

    counted = query_instances(
        model_id="host",
        analysis_mode="count",
        attr_types=attrs,
        permission_map={"1": {}},
        filter_field="os_type",
        filter_op="eq",
        filter_value="Linux",
    )
    grouped = query_instances(
        model_id="host",
        analysis_mode="distribution",
        attr_types=attrs,
        permission_map={"1": {}},
        group_by="os_type",
    )

    assert counted["instance_count"] == 4
    assert counted["status"] == "ok"
    assert counted["fields"][0]["key"] == "instance_count"
    assert grouped["items"] == [
        {"os_type": "Linux", "instance_count": 3},
        {"os_type": "Windows", "instance_count": 1},
    ]
    assert grouped["fields"][0]["key"] == "os_type"
    assert grouped["fields"][1]["role"] == "measure"
    with pytest.raises(GenericQueryError, match="模型不能为空"):
        query_instances(model_id="", analysis_mode="detail", attr_types=attrs, permission_map={"1": {}})


def test_instance_statistics_fail_over_scan_and_group_limits(monkeypatch):
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.count_by_attr",
        lambda group_by, params, permission_map, **_kwargs: {"host": SCAN_INSTANCE_MAX + 1},
    )
    with pytest.raises(GenericQueryError, match=str(SCAN_INSTANCE_MAX)):
        query_instances(
            model_id="host",
            analysis_mode="count",
            attr_types={"inst_name": "string"},
            permission_map={"1": {}},
        )

    groups = {f"os-{index}": 1 for index in range(STAT_GROUP_MAX + 1)}
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.count_by_attr",
        lambda group_by, params, permission_map, **_kwargs: groups,
    )
    with pytest.raises(GenericQueryError, match=str(STAT_GROUP_MAX)):
        query_instances(
            model_id="host",
            analysis_mode="distribution",
            attr_types={"os_type": "string", "inst_name": "string"},
            permission_map={"1": {}},
            group_by="os_type",
        )


def test_instance_aggregate_distinguishes_zero_from_empty(monkeypatch):
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.aggregate_numeric",
        lambda field, aggregation, params, permission_map, **_kwargs: {"value": 0, "scanned": 2},
    )
    zero = query_instances(
        model_id="host",
        analysis_mode="aggregate",
        attr_types={"cpu": "number", "inst_name": "string"},
        permission_map={"1": {}},
        aggregate_field="cpu",
        aggregate_op="sum",
    )
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.aggregate_numeric",
        lambda field, aggregation, params, permission_map, **_kwargs: {"value": None, "scanned": 0},
    )
    empty = query_instances(
        model_id="host",
        analysis_mode="aggregate",
        attr_types={"cpu": "number", "inst_name": "string"},
        permission_map={"1": {}},
        aggregate_field="cpu",
        aggregate_op="sum",
    )

    assert zero["status"] == "ok"
    assert zero["aggregate_value"] == 0
    assert zero["aggregate_field"] == "cpu"
    assert empty["status"] == "empty"
    assert empty["aggregate_value"] is None
    assert empty["fields"][0]["key"] == "aggregate_value"


def test_one_hop_counts_each_start_membership_without_global_dedup():
    payload = query_one_hop_relations(
        analysis_mode="distribution",
        start_instances=[{"inst_uuid": "h1"}],
        start_total=1,
        graph_result={
            "pair_count": 2,
            "groups": [
                {"end_uuid": "a", "end_name": "A", "value": 1},
                {"end_uuid": "b", "end_name": "B", "value": 1},
            ],
            "pairs": [],
        },
    )
    total = query_one_hop_relations(
        analysis_mode="count",
        start_instances=[{"inst_uuid": "h1"}],
        start_total=1,
        graph_result={"pair_count": 2, "groups": [], "pairs": []},
    )

    assert [item["start_count"] for item in payload["items"]] == [1, 1]
    assert [item["end_name"] for item in payload["items"]] == ["A", "B"]
    assert sum(item["start_count"] for item in payload["items"]) == total["relation_count"] == 2
    assert payload["fields"][0]["key"] == "end_name"


def test_one_hop_fails_when_starts_or_results_exceed_limits():
    with pytest.raises(GenericQueryError, match=str(ONE_HOP_START_MAX)):
        query_one_hop_relations(
            analysis_mode="count",
            start_instances=[],
            start_total=ONE_HOP_START_MAX + 1,
            graph_result={"pair_count": 0},
        )
    with pytest.raises(GenericQueryError, match=str(ONE_HOP_RESULT_MAX)):
        query_one_hop_relations(
            analysis_mode="detail",
            start_instances=[{"inst_uuid": "h1"}],
            start_total=1,
            graph_result={"pair_count": ONE_HOP_RESULT_MAX + 1, "pairs": None, "groups": None},
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
    ranked = query_cmdb_models(analysis_mode="distribution", page=1, page_size=1, user_info={"user": "demo"})
    untouched = query_cmdb_models(analysis_mode="distribution", user_info={"user": "demo"})
    assert [item["model_id"] for item in ranked["data"]["items"]] == ["high"]
    assert [item["model_id"] for item in untouched["data"]["items"]] == ["high", "low"]


def test_one_hop_distribution_uses_order():
    graph_result = {
        "pair_count": 3,
        "groups": [
            {"end_uuid": "b", "end_name": "B", "value": 2},
            {"end_uuid": "a", "end_name": "A", "value": 1},
        ],
        "pairs": [],
    }
    by_name = query_one_hop_relations(
        analysis_mode="distribution",
        start_instances=[{"inst_uuid": "h1"}],
        start_total=1,
        graph_result=graph_result,
        order="end_name",
    )
    by_value = query_one_hop_relations(
        analysis_mode="distribution",
        start_instances=[{"inst_uuid": "h1"}],
        start_total=1,
        graph_result=graph_result,
        order="-start_count",
    )

    assert [item["end_name"] for item in by_name["items"]] == ["A", "B"]
    assert [item["start_count"] for item in by_value["items"]] == [2, 1]
    with pytest.raises(GenericQueryError, match="不支持的排序字段"):
        query_one_hop_relations(
            analysis_mode="distribution",
            start_instances=[{"inst_uuid": "h1"}],
            start_total=1,
            graph_result=graph_result,
            order="name",
        )


def test_instance_detail_validates_sort_field_before_instance_list(monkeypatch):
    called = {}

    def fake_list(**kwargs):
        called["order"] = kwargs["order"]
        return [{"inst_name": "a"}], 1

    monkeypatch.setattr("apps.cmdb.services.generic_query.InstanceManage.instance_list", fake_list)
    with pytest.raises(GenericQueryError, match="不支持的排序字段"):
        query_instances(
            model_id="host",
            analysis_mode="detail",
            attr_types={"inst_name": "string", "os-type": "string"},
            permission_map={"1": {"inst_names": []}},
            order="os-type",
        )
    assert called == {}

    listed = query_instances(
        model_id="host",
        analysis_mode="detail",
        attr_types={"inst_name": "string"},
        permission_map={"1": {"inst_names": []}},
        order="-inst_name",
    )
    assert called["order"] == "-inst_name"
    assert listed["items"] == [{"inst_name": "a"}]


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
        if "AS value" in query:
            return [{"end_uuid": "visible", "end_name": "可见", "value": 1}]
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
        start_uuids=["s1"],
        model_asst_id="host_belong_app",
        direction="out",
        end_model_id="app",
        permission_map={1: {"inst_names": ["可见"]}},
    )
    assert result["pair_count"] == 1
    assert result["pairs"][0]["end_name"] == "可见"
    assert queries
    for query, params in queries:
        assert "t.inst_name" in query
        assert "organization" in query
        assert ["可见"] in params.values()
        assert [1] in params.values()

    over_limit = []

    def fake_over_limit(_client, query, params):
        over_limit.append(query)
        return [{"pair_count": 201}]

    monkeypatch.setattr("apps.cmdb.services.generic_query_graph._run", fake_over_limit)
    blocked = query_one_hop(
        start_uuids=["s1"],
        model_asst_id="host_belong_app",
        direction="out",
        end_model_id="app",
        permission_map={1: {"inst_names": []}},
    )
    assert blocked["pairs"] is None
    assert len(over_limit) == 1
    assert "organization" in over_limit[0]

    with pytest.raises(GenericQueryGraphError, match="权限范围"):
        query_one_hop(
            start_uuids=["s1"],
            model_asst_id="host_belong_app",
            direction="out",
            end_model_id="app",
            permission_map={},
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
        {"field": "os_type", "type": "str[]", "value": ["Linux", "Windows"]},
    ]
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
        start_uuids=["s1"],
        model_asst_id="host_belong_app",
        direction="out",
        end_model_id="app",
        permission_map={1: {"inst_names": ["可见"]}},
        end_conditions=[
            {"field": "inst_name", "type": "str=", "value": "公开"},
            {"field": "inst_name", "type": "str=", "value": "内部"},
        ],
        end_logic="OR",
    )
    query, params = queries[0]
    assert "(t.inst_name = $str3 OR t.inst_name = $str4)" in query
    assert "organization" in query
    assert query.index("organization") < query.index(" OR t.inst_name")
    assert "公开" in params.values()
    assert "内部" in params.values()


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
    assert hidden["data"] == []


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
    monkeypatch.setattr("apps.cmdb.nats.generic_query.load_start_instances", lambda **kwargs: ([], 0))
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


def test_instance_detail_hides_password_and_describes_business_columns(monkeypatch):
    captured = {}

    def fake_list(**kwargs):
        captured.update(kwargs)
        return [
            {
                "_id": 9,
                "inst_name": "web-1",
                "inst_uuid": "uuid-1",
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
        ], 1

    monkeypatch.setattr("apps.cmdb.services.generic_query.InstanceManage.instance_list", fake_list)
    payload = query_instances(
        model_id="host",
        analysis_mode="detail",
        attr_types={
            "inst_name": "str",
            "cpu": "int",
            "enabled": "bool",
            "status": "enum",
            "organization": "organization",
            "password": "pwd",
            "owner": "user",
        },
        permission_map={"1": {"inst_names": []}},
        page=1,
        page_size=20,
    )
    row = payload["items"][0]
    assert row["cpu"] == 0
    assert row["enabled"] is False
    assert row["status"] == "1"
    assert row["status_display"] == "运行中"
    assert "password" not in row
    assert "password_display" not in row
    assert "_id" not in row
    assert "name" not in row
    assert captured["page_size"] == 20

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
    monkeypatch.setattr(
        "apps.cmdb.services.generic_query.InstanceManage.instance_list",
        lambda **kwargs: ([], 0),
    )
    payload = query_instances(
        model_id="host",
        analysis_mode="detail",
        attr_types={"inst_name": "str", "status": "enum"},
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
        "apps.cmdb.services.generic_query.InstanceManage.instance_list",
        lambda **kwargs: (
            [
                {
                    "_id": 3,
                    "inst_name": "web-1",
                    "status": "1",
                    "status_display": "运行中",
                    "password": "secret-value",
                    "password_display": "secret-display",
                    "cpu": 0,
                }
            ],
            1,
        ),
    )

    loaded = query_cmdb_instances(
        model_id="host",
        classification_id="compute",
        analysis_mode="detail",
        user_info={"user": "demo"},
    )
    assert loaded["result"] is True
    row = loaded["data"]["items"][0]
    assert row["cpu"] == 0
    assert "password" not in row
    assert "password_display" not in row
    assert "_id" not in row
    fields = {field["key"]: field for field in loaded["data"]["column_fields"]["fields"]}
    assert loaded["data"]["column_fields"]["model_key"] == "host"
    assert fields["status"]["title"] == "运行状态"
    assert "password" not in fields
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
        "apps.cmdb.nats.generic_query.load_start_instances",
        lambda **kwargs: (
            [
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
            1,
        ),
    )
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.query_one_hop",
        lambda **kwargs: {
            "pair_count": 1,
            "groups": [],
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
    monkeypatch.setattr(
        "apps.cmdb.nats.generic_query.load_instances_by_uuids",
        lambda uuids: [
            {
                "inst_uuid": "e1",
                "inst_name": "应用甲",
                "model_id": "app",
                "status": "up",
                "status_display": "在线",
                "enabled": False,
            }
        ],
    )

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
    assert distribution_result["data"]["page_size"] == 10
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
    assert second_result["result"] is True
    assert second_result["data"]["items"] == []
    assert second_result["data"]["count"] == 3

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

    def grouped_counts(group_by, params, permission_map, **_kwargs):
        return buckets

    monkeypatch.setattr("apps.cmdb.services.generic_query.count_by_attr", grouped_counts)

    def grouped(values, value_type):
        buckets.clear()
        buckets.update(values)
        return query_instances(
            model_id="host",
            analysis_mode="distribution",
            attr_types={"enabled": "bool", "inst_name": "string"},
            permission_map={"1": {}},
            group_by="enabled",
            group_title="是否启用",
            group_value_type=value_type,
        )

    boolean = grouped({False: 2, None: 3, "": 4}, "boolean")
    assert boolean["fields"][0] == {
        "key": "enabled",
        "title": "是否启用",
        "value_type": "boolean",
        "role": "dimension",
    }
    boolean_values = [item["enabled"] for item in boolean["items"]]
    assert any(value is False for value in boolean_values)
    assert None in boolean_values
    assert "" in boolean_values
    assert {item["instance_count"] for item in boolean["items"]} == {2, 3, 4}

    numeric = grouped({0: 1}, "number")
    assert numeric["items"] == [{"enabled": 0, "instance_count": 1}]
    assert numeric["items"][0]["enabled"] is not False

    with pytest.raises(GenericQueryError, match="不支持的排序字段"):
        query_instances(
            model_id="host",
            analysis_mode="distribution",
            attr_types={"enabled": "bool", "inst_name": "string"},
            permission_map={"1": {}},
            group_by="enabled",
            order="name",
        )


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


def test_one_hop_distribution_keeps_blank_end_name():
    payload = query_one_hop_relations(
        analysis_mode="distribution",
        start_instances=[{"inst_uuid": "h1"}],
        start_total=1,
        graph_result={
            "pair_count": 1,
            "groups": [{"end_uuid": "end-1", "value": 0}],
            "pairs": [],
        },
    )
    assert payload["items"] == [{"end_name": "", "end_uuid": "end-1", "start_count": 0}]
    assert payload["fields"][1]["role"] == "identity"
    assert payload["fields"][2]["key"] == "start_count"
