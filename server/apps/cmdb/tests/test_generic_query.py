"""CMDB 通用查询的统计口径、上限和空结果。"""

import pytest

from apps.cmdb.services.generic_query import GenericQueryError, query_instances, query_models, query_one_hop_relations
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
        order="-instance_count",
        page=1,
        page_size=2,
    )

    assert rows["status"] == "ok"
    assert rows["count"] == 3
    assert [item["model_id"] for item in rows["items"]] == ["host", "net"]
    assert rows["items"][1]["instance_count"] == 0


def test_model_count_splits_empty_and_non_empty_without_dropping_zeros_first():
    models = [
        _model("host", "主机", "compute", "计算"),
        _model("net", "网络", "compute", "计算"),
    ]
    counts = {"host": 2, "net": 0}

    non_empty = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="count",
        result_op="gt",
        result_value=0,
    )
    empty = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="count",
        result_op="eq",
        result_value=0,
    )

    assert non_empty == {"structure": "value", "status": "ok", "value": 1, "unit": "个", "aggregation": "模型计数"}
    assert empty["value"] == 1
    assert empty["status"] == "ok"


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
    by_name = query_models(
        models=models,
        instance_counts={"host": 2, "net": 3},
        analysis_mode="distribution",
        order="name",
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
    assert payload["unit"] == "个"
    assert payload["aggregation"] == "按模型统计权限内实例数，含零实例模型"
    assert payload["items"] == [
        {"name": "网络", "model_id": "net", "value": 3},
        {"name": "主机", "model_id": "host", "value": 2},
        {"name": "机房", "model_id": "room", "value": 0},
    ]
    assert [item["name"] for item in by_name["items"]] == ["主机", "机房", "网络"]
    assert [item["model_id"] for item in classified["items"]] == ["net", "host"]
    assert selected["items"] == [{"name": "机房", "model_id": "room", "value": 0}]
    assert counted["value"] == 2
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

    assert [(item["model_id"], item["name"], item["value"]) for item in payload["items"]] == [
        ("host", "主机 (host)", 4),
        ("host_shadow", "主机 (host_shadow)", 4),
        ("room", "机房", 4),
        ("literal", "主机 (host) (literal)", 1),
    ]


def test_model_distribution_rejects_paging_and_group_limit():
    with pytest.raises(GenericQueryError, match="不支持分页"):
        query_models(
            models=[_model("host", "主机", "compute", "计算")],
            instance_counts={"host": 1},
            analysis_mode="distribution",
            page=1,
            page_size=20,
        )
    too_many = [_model(f"m{index}", f"模型{index}", "compute", "计算") for index in range(STAT_GROUP_MAX + 1)]
    with pytest.raises(GenericQueryError, match=str(STAT_GROUP_MAX)):
        query_models(
            models=too_many,
            instance_counts={},
            analysis_mode="distribution",
        )


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
    assert payload["page_size"] == 20
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

    assert counted["value"] == 4
    assert counted["status"] == "ok"
    assert grouped["items"] == [
        {"name": "Linux", "value": 3},
        {"name": "Windows", "value": 1},
    ]
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
    assert zero["value"] == 0
    assert empty["status"] == "empty"
    assert empty["value"] is None


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

    assert [item["value"] for item in payload["items"]] == [1, 1]
    assert sum(item["value"] for item in payload["items"]) == total["value"] == 2


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
    assert result["data"]["value"] == 1
    assert "unexpected" not in result["data"]


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
        order="name",
    )
    by_value = query_one_hop_relations(
        analysis_mode="distribution",
        start_instances=[{"inst_uuid": "h1"}],
        start_total=1,
        graph_result=graph_result,
        order="-value",
    )

    assert [item["name"] for item in by_name["items"]] == ["A", "B"]
    assert [item["value"] for item in by_value["items"]] == [2, 1]


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


def test_instance_count_filter_runs_before_distribution_and_keeps_legacy_and():
    models = [
        _model("host", "主机", "compute", "计算"),
        _model("net", "网络", "compute", "计算"),
        _model("room", "机房", "space", "空间"),
    ]
    counts = {"host": 5, "net": 1, "room": 0}
    grouped = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="distribution",
        result_filter={
            "logic": "OR",
            "items": [{"field": "instance_count", "op": "gt", "value": 3}, {"field": "instance_count", "op": "eq", "value": 0}],
        },
        order="name",
    )
    assert grouped["items"] == [
        {"name": "主机", "model_id": "host", "value": 5},
        {"name": "机房", "model_id": "room", "value": 0},
    ]
    assert grouped["unit"] == "个"
    assert grouped["aggregation"] == "按模型统计权限内实例数，含零实例模型"
    widened = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="count",
        result_filter={
            "logic": "OR",
            "items": [{"field": "instance_count", "op": "gt", "value": 3}, {"field": "instance_count", "op": "eq", "value": 0}],
        },
    )
    narrowed = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode="count",
        result_op="gt",
        result_value=0,
        result_filter={
            "logic": "OR",
            "items": [{"field": "instance_count", "op": "gt", "value": 3}, {"field": "instance_count", "op": "eq", "value": 0}],
        },
    )
    assert widened["value"] == 2
    assert narrowed["value"] == 1


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
    monkeypatch.setattr("apps.cmdb.nats.generic_query._attr_types", lambda model_id, user_info: {"inst_name": "string"})
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


def _scope_models():
    """假设数据：主机 100、虚机 50、路由 0。路由没有计数记录，按零实例保留。"""
    return [
        _model("host", "主机", "compute", "计算"),
        _model("vm", "虚机", "compute", "计算"),
        _model("router", "路由", "network", "网络"),
    ]


_SCOPE_COUNTS = {"host": 100, "vm": 50}


def test_single_value_count_metric_keeps_model_count_until_asked_for_instances():
    models = _scope_models()
    counted = query_models(models=models, instance_counts=_SCOPE_COUNTS, analysis_mode="count")
    blank = query_models(models=models, instance_counts=_SCOPE_COUNTS, analysis_mode="count", count_metric="")
    named = query_models(models=models, instance_counts=_SCOPE_COUNTS, analysis_mode="count", count_metric=" model_count ")
    total = query_models(models=models, instance_counts=_SCOPE_COUNTS, analysis_mode="count", count_metric="instance_total")
    selected = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        model_ids=["host"],
    )
    selected_total = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        model_ids=["host"],
        count_metric="instance_total",
    )

    assert counted == {"structure": "value", "status": "ok", "value": 3, "unit": "个", "aggregation": "模型计数"}
    assert set(counted) == {"structure", "status", "value", "unit", "aggregation"}
    assert blank == counted
    assert named == counted
    assert total == {"structure": "value", "status": "ok", "value": 150, "unit": "个", "aggregation": "实例总数"}
    assert selected["value"] == 1
    assert selected["aggregation"] == "模型计数"
    assert selected_total["value"] == 100
    assert selected_total["aggregation"] == "实例总数"
    assert "page" not in total
    assert "items" not in total


def test_count_metric_uses_the_same_scope_before_instance_filters():
    models = _scope_models()
    classified = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        classification_id="compute",
        count_metric="instance_total",
    )
    classified_models = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        classification_id="compute",
    )
    router = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        model_ids=["router"],
        count_metric="instance_total",
    )
    narrowed = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        result_filter={
            "logic": "AND",
            "items": [
                {"field": "instance_count", "op": "gt", "value": 0},
                {"field": "instance_count", "op": "lt", "value": 80},
            ],
        },
    )
    narrowed_total = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        count_metric="instance_total",
        result_filter={
            "logic": "AND",
            "items": [
                {"field": "instance_count", "op": "gt", "value": 0},
                {"field": "instance_count", "op": "lt", "value": 80},
            ],
        },
    )
    or_filter = {
        "logic": "OR",
        "items": [
            {"field": "instance_count", "op": "gt", "value": 80},
            {"field": "instance_count", "op": "eq", "value": 0},
        ],
    }
    either = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        count_metric="instance_total",
        result_filter=or_filter,
    )
    either_models = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        result_filter=or_filter,
    )
    legacy_and = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        count_metric="instance_total",
        result_op="gt",
        result_value=0,
        result_filter=or_filter,
    )
    none = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        count_metric="instance_total",
        result_filter={"logic": "AND", "items": [{"field": "instance_count", "op": "gt", "value": 1000}]},
    )
    none_models = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        result_filter={"logic": "AND", "items": [{"field": "instance_count", "op": "gt", "value": 1000}]},
    )
    empty_models = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        result_op="eq",
        result_value=0,
    )
    empty_total = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="count",
        count_metric="instance_total",
        result_op="eq",
        result_value=0,
    )

    assert classified_models["value"] == 2
    assert classified["value"] == 150
    assert router == {"structure": "value", "status": "ok", "value": 0, "unit": "个", "aggregation": "实例总数"}
    assert narrowed["value"] == 1
    assert narrowed["aggregation"] == "模型计数"
    assert narrowed_total["value"] == 50
    assert either_models["value"] == 2
    assert either["value"] == 100
    assert legacy_and["value"] == 100
    assert none["status"] == "ok"
    assert none["value"] == 0
    assert none["aggregation"] == "实例总数"
    assert none_models["status"] == "ok"
    assert none_models["value"] == 0
    assert empty_models["value"] == 1
    assert empty_total["value"] == 0


def test_count_metric_is_ignored_outside_count_and_rejects_unknown_values():
    models = _scope_models()
    detail = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="detail",
        count_metric="instance_total",
        page=1,
        page_size=1,
        order="model_id",
    )
    plain_detail = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="detail",
        page=1,
        page_size=1,
        order="model_id",
    )
    distribution = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="distribution",
        count_metric="by_classification",
    )
    plain_distribution = query_models(
        models=models,
        instance_counts=_SCOPE_COUNTS,
        analysis_mode="distribution",
    )

    assert detail == plain_detail
    assert detail["count"] == 3
    assert len(detail["items"]) == 1
    assert list(detail["items"][0]) == list(DETAIL_COLUMNS)
    assert distribution == plain_distribution
    assert [item["model_id"] for item in distribution["items"]] == ["host", "vm", "router"]
    assert distribution["aggregation"] == "按模型统计权限内实例数，含零实例模型"
    with pytest.raises(GenericQueryError, match="统计内容不受支持"):
        query_models(
            models=models,
            instance_counts=_SCOPE_COUNTS,
            analysis_mode="count",
            count_metric="by_classification",
        )
    with pytest.raises(GenericQueryError, match="不支持分页"):
        query_models(
            models=models,
            instance_counts=_SCOPE_COUNTS,
            analysis_mode="count",
            count_metric="instance_total",
            page=1,
            page_size=1,
        )


def test_instance_total_keeps_the_scan_limit_before_filtering():
    with pytest.raises(GenericQueryError, match=str(SCAN_INSTANCE_MAX)):
        query_models(
            models=[
                _model("host", "主机", "compute", "计算"),
                _model("router", "路由", "network", "网络"),
            ],
            instance_counts={"host": SCAN_INSTANCE_MAX + 1, "router": 0},
            analysis_mode="count",
            count_metric="instance_total",
            result_filter={"logic": "AND", "items": [{"field": "instance_count", "op": "eq", "value": 0}]},
        )


def test_count_metric_permission_failure_is_not_reported_as_zero(monkeypatch):
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
        count_metric="instance_total",
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
        count_metric="model_count",
        model_id="host",
        user_info={"user": "demo", "team": 7},
    )
    assert denied_instances["result"] is False
    assert denied_instances["data"] == {"status": "forbidden"}
    assert "value" not in denied_instances["data"]
    assert calls["count"] == 0


def test_handler_count_metric_uses_full_permission_counts(monkeypatch):
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

    total = query_cmdb_models(analysis_mode="count", count_metric="instance_total", user_info={"user": "demo"})
    assert total["result"] is True
    assert total["data"]["value"] == 150
    assert total["data"]["status"] == "ok"
    ensure_payload_limit(total["data"])
    assert calls == [("model_id", [], {"7": {"inst_names": ["visible-host"]}})]

    selected = query_cmdb_models(analysis_mode="count", model_id="host", user_info={"user": "demo"})
    assert selected["data"]["value"] == 1
    assert selected["data"]["aggregation"] == "模型计数"

    classified = query_cmdb_models(
        analysis_mode="count",
        classification_id="compute",
        count_metric="model_count",
        user_info={"user": "demo"},
    )
    assert classified["data"]["value"] == 2

    paged = query_cmdb_models(
        analysis_mode="count",
        count_metric="instance_total",
        page=1,
        page_size=1,
        user_info={"user": "demo"},
    )
    assert paged["result"] is False
    assert "分页" in paged["message"]

    detail = query_cmdb_models(
        analysis_mode="detail",
        count_metric="instance_total",
        page=1,
        page_size=1,
        order="model_name",
        user_info={"user": "demo"},
    )
    assert detail["result"] is True
    assert detail["data"]["count"] == 3
    assert len(detail["data"]["items"]) == 1
    assert list(detail["data"]["items"][0]) == list(DETAIL_COLUMNS)

    missing = query_cmdb_models(
        analysis_mode="count",
        count_metric="instance_total",
        model_id="secret",
        user_info={"user": "demo"},
    )
    assert missing["result"] is False
    assert missing["data"] == {"status": "forbidden"}

    unknown_class = query_cmdb_models(
        analysis_mode="count",
        count_metric="instance_total",
        classification_id="secret",
        user_info={"user": "demo"},
    )
    assert unknown_class["result"] is False
    assert unknown_class["data"] == {"status": "forbidden"}
    assert "value" not in unknown_class["data"]

    illegal = query_cmdb_models(
        analysis_mode="count",
        count_metric="by_classification",
        user_info={"user": "demo"},
    )
    assert illegal["result"] is False
    assert illegal["data"] == {"status": "failed"}
    assert "统计内容" in illegal["message"]

    distribution = query_cmdb_models(
        analysis_mode="distribution",
        count_metric="instance_total",
        user_info={"user": "demo"},
    )
    assert distribution["result"] is True
    assert [item["model_id"] for item in distribution["data"]["items"]] == ["host", "vm", "router"]
    assert distribution["data"]["aggregation"] == "按模型统计权限内实例数，含零实例模型"
