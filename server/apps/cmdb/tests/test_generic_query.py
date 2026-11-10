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


def test_model_distribution_sums_by_classification_and_keeps_zero_class():
    payload = query_models(
        models=[
            _model("host", "主机", "compute", "计算"),
            _model("net", "网络", "compute", "计算"),
            _model("room", "机房", "space", "空间"),
        ],
        instance_counts={"host": 2, "net": 3},
        analysis_mode="distribution",
        order="name",
    )

    assert payload["status"] == "ok"
    assert payload["aggregation"] == "按分类汇总实例数，含零实例模型"
    assert payload["items"] == [
        {"name": "空间", "classification_id": "space", "value": 0},
        {"name": "计算", "classification_id": "compute", "value": 5},
    ]


def test_model_statistics_fail_when_scan_exceeds_limit():
    with pytest.raises(GenericQueryError, match=str(SCAN_INSTANCE_MAX)):
        query_models(
            models=[_model("host", "主机", "compute", "计算")],
            instance_counts={"host": SCAN_INSTANCE_MAX + 1},
            analysis_mode="count",
        )


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
        {"name": "空间", "classification_id": "space", "value": 0},
        {"name": "计算", "classification_id": "compute", "value": 5},
    ]
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
