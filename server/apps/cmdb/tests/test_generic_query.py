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
    def fake_count(group_by, params, permission_map):
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
        lambda group_by, params, permission_map: {"host": SCAN_INSTANCE_MAX + 1},
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
        lambda group_by, params, permission_map: groups,
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
        lambda field, aggregation, params, permission_map: {"value": 0, "scanned": 2},
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
        lambda field, aggregation, params, permission_map: {"value": None, "scanned": 0},
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
