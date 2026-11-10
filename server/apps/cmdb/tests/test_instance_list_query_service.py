import pytest

from apps.cmdb.services.instance_query import (
    BUCKET_LIMIT_MESSAGE,
    MATERIALIZE_LIMIT_MESSAGE,
    MAX_BUCKETS,
    MAX_PAGE_SIZE,
    MAX_SCAN,
    CmdbInstanceQueryService,
    describe_query_fields,
)

HOST = {"model_id": "host", "model_name": "主机", "classification_id": "compute", "classification_name": "计算"}
APP = {"model_id": "app", "model_name": "应用", "classification_id": "biz", "classification_name": "业务"}
HOST_ATTRS = [
    {"attr_id": "ip_addr", "attr_name": "内网IP", "attr_type": "str", "is_required": True},
    {
        "attr_id": "os_type",
        "attr_name": "系统类型",
        "attr_type": "enum",
        "enum_options": [{"id": "2", "name": "Linux"}, {"id": "3", "name": "Windows"}],
    },
    {"attr_id": "cpu_count", "attr_name": "CPU核数", "attr_type": "int", "unit": "核"},
    {"attr_id": "capacity", "attr_name": "容量", "attr_type": "int", "unit": "GB"},
    {"attr_id": "enabled", "attr_name": "启用", "attr_type": "bool"},
    {"attr_id": "organization", "attr_name": "组织", "attr_type": "organization"},
]
APP_ATTRS = [
    {"attr_id": "capacity", "attr_name": "容量", "attr_type": "int", "unit": "个"},
    {"attr_id": "app_code", "attr_name": "应用编码", "attr_type": "str"},
]
MODELS = [HOST, APP]
ATTRS = {"host": HOST_ATTRS, "app": APP_ATTRS}


def _permission(model_id):
    return {1: {"inst_names": [model_id]}}


PERM = _permission


def _service(rows=None, counts=None, groups=None):
    calls = {"list": [], "group": []}

    def list_instances(**kwargs):
        calls["list"].append(kwargs)
        model_id = kwargs["model_id"]
        payload = list((rows or {}).get(model_id, []))
        total = (counts or {}).get(model_id, len(payload))
        if kwargs["page_size"] == 1:
            return payload[:1], total
        return payload, total

    def group_counts(**kwargs):
        calls["group"].append(kwargs)
        model_id = kwargs["params"][0]["value"]
        return {} if groups is None else (groups or {}).get(model_id, {})

    service = CmdbInstanceQueryService(list_instances, group_counts)
    return service, calls


def _run(service, **kwargs):
    params = dict(
        models=MODELS,
        attrs_by_model=ATTRS,
        classifications=[{"classification_id": "compute", "classification_name": "计算"}, {"classification_id": "biz", "classification_name": "业务"}],
        analysis_mode="list",
        permission_for=PERM,
        creator="alice",
    )
    params.update(kwargs)
    return service.run(**params)


def test_host_detail_uses_chinese_columns_and_applies_filter_before_page():
    service, calls = _service(
        rows={"host": [{"inst_uuid": "u1", "inst_name": "web", "model_id": "host", "ip_addr": "10.0.0.8", "os_type": "2", "_id": 9}]},
        counts={"host": 30},
    )
    result = _run(
        service,
        model_ids=["host"],
        analysis_mode="list",
        conditions={"logic": "and", "children": [{"scope": "host", "attr_id": "ip_addr", "operator": "str=", "value": "10.0.0.8"}]},
        order="-ip_addr",
        page=2,
        page_size=5,
    )
    assert calls["list"][0]["page"] == 2
    assert calls["list"][0]["page_size"] == 5
    assert calls["list"][0]["order"] == "-ip_addr"
    assert calls["list"][0]["params"] == [{"field": "ip_addr", "type": "str=", "value": "10.0.0.8"}]
    assert result["count"] == 30
    assert result["items"][0]["host:ip_addr"] == "10.0.0.8"
    titles = {field["key"]: field["title"] for field in result["fields"]}
    assert titles["host:ip_addr"] == "主机 · 内网IP"
    assert titles["host:os_type"] == "主机 · 系统类型"
    assert "organization" not in titles


def test_order_candidates_follow_the_columns_each_mode_accepts():
    listed = describe_query_fields(MODELS, ATTRS, "list")
    list_keys = {row["key"] for row in listed if row.get("orderable") and "list" in row.get("order_modes", [])}
    assert {"inst_name", "inst_uuid", "model_id", "model_name", "host:ip_addr"} <= list_keys
    note = {"attr_id": "note", "attr_name": "备注", "attr_type": "str", "is_display_field": True}
    with_note = describe_query_fields([HOST], {"host": [*HOST_ATTRS, note]}, "list")
    note_row = next(row for row in with_note if row["key"] == "host:note")
    assert note_row["orderable"] is False
    assert note_row["order_modes"] == []

    counted = describe_query_fields(MODELS, ATTRS, "count")
    count_keys = {row["key"] for row in counted if row.get("orderable") and "count" in row.get("order_modes", [])}
    assert count_keys == {"model_id", "model_name", "count", "scope_count"}

    distributed = describe_query_fields(MODELS, ATTRS, "distribution")
    distribution_keys = {row["key"] for row in distributed if row.get("orderable") and "distribution" in row.get("order_modes", [])}
    assert distribution_keys == {"model_id", "model_name", "count", "group_value", "field_label", "group_kind"}


@pytest.mark.parametrize("conditions", [None, [], {}, "", {"logic": "and", "children": []}])
def test_empty_conditions_keep_every_selected_model(conditions):
    service, calls = _service(
        rows={"host": [{"inst_name": "web"}], "app": [{"inst_name": "shop"}]},
        counts={"host": 1, "app": 1},
    )
    result = _run(service, model_ids=["host", "app"], analysis_mode="list", conditions=conditions)
    assert calls["list"]
    assert all(call["params"] == [] for call in calls["list"])
    assert {item["model_id"] for item in result["items"]} == {"host", "app"}


def test_empty_condition_card_does_not_filter_that_model():
    service, calls = _service(counts={"host": 3})
    result = _run(
        service,
        model_ids=["host"],
        analysis_mode="count",
        conditions={"logic": "and", "children": [{"logic": "and", "model_id": "host", "children": []}]},
    )
    assert result["items"][0]["count"] == 3
    assert calls["list"][0]["params"] == []


def test_count_changes_when_the_condition_changes():
    service, calls = _service(counts={"host": 4})
    linux = {
        "logic": "and",
        "children": [{"scope": "host", "attr_id": "os_type", "operator": "list_any[]", "value": ["2"]}],
    }
    first = _run(service, model_ids=["host"], analysis_mode="count", conditions=linux)
    assert first["items"][0]["count"] == 4
    assert first["items"][0]["scope_count"] == 4
    assert calls["list"][0]["params"] == [{"field": "os_type", "type": "list_any[]", "value": ["2"]}]
    assert calls["list"][0]["page_size"] == 1
    service, calls = _service(counts={"host": 9})
    second = _run(service, model_ids=["host"], analysis_mode="count")
    assert second["items"][0]["count"] == 9
    assert calls["list"][0]["params"] == []


def test_distribution_uses_enum_label_and_pages_after_the_full_count():
    service, calls = _service(groups={"host": {"2": 2, "3": 5, None: 1, "": 4}})
    result = _run(
        service,
        model_ids=["host"],
        analysis_mode="distribution",
        group_by=[{"sources": ["host:os_type"], "label": "系统类型"}],
        page=1,
        page_size=2,
    )
    assert calls["group"][0]["group_by_attr"] == "os_type"
    assert [row["group_value"] for row in result["items"]] == ["Windows", ""]
    assert result["count"] == 4
    assert result["items"][0]["count"] == 5
    full = _run(
        service,
        model_ids=["host"],
        analysis_mode="distribution",
        group_by=["os_type"],
        page_size=20,
    )
    kinds = {row["group_kind"] for row in full["items"]}
    assert {"unfilled", "empty", "value"} <= kinds


def test_distribution_separates_not_applicable_and_unfilled():
    service, _calls = _service(counts={"host": 3, "app": 8}, groups={"host": {None: 1, "": 2}})
    result = _run(
        service,
        model_ids=["host", "app"],
        analysis_mode="distribution",
        group_by=[{"sources": ["host:os_type"]}],
        page_size=20,
    )
    by_model = {}
    for row in result["items"]:
        by_model.setdefault(row["model_id"], []).append(row)
    assert {row["group_kind"] for row in by_model["host"]} == {"unfilled", "empty"}
    assert by_model["app"][0]["group_kind"] == "not_applicable"
    assert by_model["app"][0]["group_value"] == "不适用"
    assert by_model["app"][0]["count"] == 8
    hidden = _run(
        service,
        model_ids=["host", "app"],
        analysis_mode="distribution",
        group_by=[{"sources": ["host:os_type"]}],
        show_not_applicable=False,
        show_unfilled=False,
        page_size=20,
    )
    assert [row["group_kind"] for row in hidden["items"]] == ["empty"]


def test_numeric_aggregate_sums_real_values():
    service, calls = _service(
        rows={"host": [{"inst_uuid": "a", "cpu_count": 4}, {"inst_uuid": "b", "cpu_count": 8}, {"inst_uuid": "c", "cpu_count": None}]},
    )
    result = _run(
        service,
        model_ids=["host"],
        analysis_mode="aggregate",
        metrics=[{"key": "cpu_sum", "label": "CPU核数", "func": "sum", "sources": ["host:cpu_count"]}],
    )
    assert result["items"][0]["cpu_sum"] == 12
    assert result["items"][0]["cpu_sum__applicability"] == "有效"
    assert calls["list"][-1]["page_size"] == 3
    assert "暂不支持" not in str(result)


def test_model_is_required_before_instance_reads_and_classification_still_intersects():
    service, calls = _service(counts={"host": 2, "app": 5})
    for mode in ("list", "count", "distribution", "aggregate"):
        for raw in (None, [], ""):
            with pytest.raises(ValueError, match="请选择模型"):
                _run(service, model_ids=raw, analysis_mode=mode, classification_ids=["compute"])
    with pytest.raises(ValueError, match="格式不正确"):
        _run(service, model_ids=5, analysis_mode="list")
    with pytest.raises(ValueError, match="不合法"):
        _run(service, model_ids=["bad id"], analysis_mode="count")
    assert calls["list"] == []
    assert calls["group"] == []
    models_only = _run(service, model_ids=["host"], analysis_mode="count")
    assert [row["model_id"] for row in models_only["items"]] == ["host"]
    both = _run(service, classification_ids=["compute"], model_ids=["host"], analysis_mode="count")
    assert [row["model_id"] for row in both["items"]] == ["host"]
    with pytest.raises(ValueError, match="不属于所选分类"):
        _run(service, classification_ids=["compute"], model_ids=["app"], analysis_mode="count")
    with pytest.raises(ValueError, match="无权查询实例"):
        _run(service, model_ids=["host"], analysis_mode="count", permission_for=lambda model_id: {})
    assert all(call["model_id"] != "other" for call in calls["list"])


def test_legal_zero_keeps_fields_and_unknown_model_does_not_expand():
    service, calls = _service(counts={"host": 0})
    result = _run(service, model_ids=["host"], analysis_mode="list")
    assert result["items"] == []
    assert result["count"] == 0
    assert any(field["key"] == "host:ip_addr" for field in result["fields"])
    with pytest.raises(ValueError, match="不可见"):
        _run(service, model_ids=["ghost"], analysis_mode="list")
    assert calls["list"][-1]["model_id"] == "host"


def test_same_display_name_stays_two_fields_until_explicit_mapping():
    service, _calls = _service(
        rows={
            "host": [{"inst_uuid": "h", "inst_name": "h1", "capacity": 2}],
            "app": [{"inst_uuid": "a", "inst_name": "a1", "capacity": 9}],
        },
    )
    result = _run(service, model_ids=["host", "app"], analysis_mode="list", page_size=20)
    titles = [field["title"] for field in result["fields"]]
    assert "主机 · 容量" in titles
    assert "应用 · 容量" in titles
    host_row = next(row for row in result["items"] if row["model_id"] == "host")
    assert host_row["host:capacity"] == 2
    assert host_row["app:capacity"] is None


def test_global_condition_excludes_models_without_the_attribute_and_model_condition_does_not():
    service, calls = _service(counts={"host": 2, "app": 6})
    host_only = {"logic": "and", "children": [{"scope": "host", "attr_id": "os_type", "operator": "list_any[]", "value": ["2"]}]}
    result = _run(service, model_ids=["host", "app"], analysis_mode="count", conditions=host_only)
    counts = {row["model_id"]: row["count"] for row in result["items"]}
    assert counts == {"host": 2, "app": 6}
    app_params = [call["params"] for call in calls["list"] if call["model_id"] == "app"]
    assert app_params == [[]]


def test_global_unsatisfiable_model_contributes_zero():
    service, calls = _service(counts={"host": 2, "app": 6})
    tree = {"logic": "and", "children": [{"scope": "global", "attr_id": "os_type", "operator": "list_any[]", "value": ["2"]}]}
    result = _run(service, model_ids=["host", "app"], analysis_mode="count", conditions=tree)
    counts = {row["model_id"]: row["count"] for row in result["items"]}
    assert counts["host"] == 2
    assert counts["app"] == 0
    assert not any(call["model_id"] == "app" and call["params"] == [] and call["page_size"] != 1 for call in calls["list"])


def test_or_and_typed_operators_are_sent_to_the_graph():
    service, calls = _service(rows={"host": [{"inst_uuid": "h", "inst_name": "web", "cpu_count": 8}]}, counts={"host": 1})
    tree = {
        "logic": "or",
        "children": [
            {"scope": "host", "attr_id": "cpu_count", "operator": "int>", "value": 4},
            {"scope": "host", "attr_id": "ip_addr", "operator": "str*", "value": "10."},
        ],
    }
    _run(service, model_ids=["host"], analysis_mode="count", conditions=tree)
    params = [item for call in calls["list"] for item in call["params"]]
    assert {"field": "cpu_count", "type": "int>", "value": 4} in params
    assert {"field": "ip_addr", "type": "str*", "value": "10."} in params


def test_invalid_operator_and_enum_are_rejected():
    service, calls = _service(counts={"host": 3})
    with pytest.raises(ValueError, match="不支持运算符"):
        _run(
            service,
            model_ids=["host"],
            analysis_mode="count",
            conditions={"logic": "and", "children": [{"scope": "host", "attr_id": "ip_addr", "operator": "int>", "value": 1}]},
        )
    with pytest.raises(ValueError, match="不在可选范围"):
        _run(
            service,
            model_ids=["host"],
            analysis_mode="count",
            conditions={"logic": "and", "children": [{"scope": "host", "attr_id": "os_type", "operator": "list_any[]", "value": ["linux"]}]},
        )
    assert calls["list"] == []


def test_aggregate_keeps_models_separate_until_a_compatible_mapping():
    service, _calls = _service(
        rows={
            "host": [{"inst_uuid": "h", "cpu_count": 4}],
            "app": [{"inst_uuid": "a", "app_code": "crm"}],
        },
        counts={"host": 1, "app": 3},
    )
    separate = _run(
        service,
        model_ids=["host", "app"],
        analysis_mode="aggregate",
        metrics=[
            {"key": "cpu_sum", "label": "CPU核数", "func": "sum", "sources": ["host:cpu_count"]},
            {"key": "app_count", "label": "应用数量", "func": "count", "sources": ["app:app_code"]},
        ],
    )
    by_model = {row["model_id"]: row for row in separate["items"]}
    assert by_model["host"]["cpu_sum"] == 4
    assert by_model["host"]["app_count__applicability"] == "不适用"
    assert by_model["app"]["app_count"] == 3
    assert by_model["app"]["cpu_sum__applicability"] == "不适用"
    with pytest.raises(ValueError, match="类型或单位不一致"):
        _run(
            service,
            model_ids=["host", "app"],
            analysis_mode="aggregate",
            metrics=[{"key": "mixed", "label": "容量", "func": "sum", "sources": ["host:capacity", "app:capacity"]}],
        )


def test_compatible_mapping_merges_one_metric():
    vm = {"model_id": "vm", "model_name": "虚拟机", "classification_id": "compute", "classification_name": "计算"}
    attrs = {**ATTRS, "vm": [{"attr_id": "cpu_count", "attr_name": "CPU核数", "attr_type": "int", "unit": "核"}]}
    service, _calls = _service(rows={"host": [{"inst_uuid": "h", "cpu_count": 4}], "vm": [{"inst_uuid": "v", "cpu_count": 6}]})
    result = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=[{"key": "cpu_sum", "label": "CPU核数", "func": "sum", "sources": ["host:cpu_count", "vm:cpu_count"]}],
        permission_for=PERM,
    )
    assert result["items"] == [
        {
            "model_id": "host,vm",
            "model_name": "主机、虚拟机",
            "cpu_sum": 10,
            "cpu_sum__applicability": "有效",
        }
    ]
    assert result["fields"][2]["unit"] == "核"
    assert result["fields"][2]["aggregation"] == "sum"
    assert "按实例合并" in result["fields"][2]["description"]
    assert "app" not in result["items"][0]["model_id"]


def test_removed_condition_field_is_not_dropped():
    service, calls = _service(counts={"host": 4})
    with pytest.raises(ValueError, match="不存在"):
        _run(
            service,
            model_ids=["host"],
            analysis_mode="count",
            conditions={"logic": "and", "children": [{"scope": "host", "attr_id": "gone", "operator": "str=", "value": "x"}]},
        )
    assert calls["list"] == []


def test_over_limit_fails_instead_of_scanning_a_prefix():
    service, calls = _service(rows={"host": [{"inst_uuid": "only"}]}, counts={"host": MAX_SCAN + 1})
    with pytest.raises(ValueError, match="不会只使用已取出"):
        _run(
            service,
            model_ids=["host"],
            analysis_mode="aggregate",
            metrics=[{"key": "cpu_sum", "label": "CPU核数", "func": "sum", "sources": ["host:cpu_count"]}],
        )
    assert calls["list"][-1]["page_size"] == 1
    assert all(call["page_size"] == 1 for call in calls["list"])


def test_page_size_above_max_fails_and_legacy_equality_still_filters():
    service, calls = _service(counts={"host": 2}, groups={"host": {"2": 2}})
    with pytest.raises(ValueError, match=str(MAX_PAGE_SIZE)):
        _run(service, model_ids=["host"], analysis_mode="count", page_size=MAX_PAGE_SIZE + 1)
    result = _run(service, model_id="host", analysis_mode="distribution", group_by="os_type", attr_filters="enabled=true")
    assert result["items"][0]["group_value"] == "Linux"
    assert calls["group"][-1]["params"][1] == {"field": "enabled", "type": "bool", "value": True}
    with pytest.raises(ValueError, match="仅支持等值"):
        _run(service, model_id="host", analysis_mode="list", attr_filters="ip_addr!=10.0.0.1")


def test_global_condition_rejects_same_attr_with_different_units():
    service, calls = _service()
    with pytest.raises(ValueError, match="同名属性默认不是同一字段"):
        _run(
            service,
            model_ids=["host", "app"],
            analysis_mode="count",
            conditions={"logic": "and", "children": [{"scope": "global", "attr_id": "capacity", "operator": "int>", "value": 1}]},
        )
    with pytest.raises(ValueError, match="类型或单位不一致"):
        _run(
            service,
            model_ids=["host", "app"],
            analysis_mode="count",
            conditions={
                "logic": "and",
                "children": [
                    {
                        "scope": "global",
                        "sources": ["host:capacity", "app:capacity"],
                        "operator": "int>",
                        "value": 1,
                    }
                ],
            },
        )
    assert calls["list"] == []


def test_explicit_mapping_aggregates_each_function_across_instances():
    vm = {"model_id": "vm", "model_name": "虚拟机", "classification_id": "compute", "classification_name": "计算"}
    attrs = {
        "host": [{"attr_id": "cpu_count", "attr_name": "CPU核数", "attr_type": "int", "unit": "核"}],
        "vm": [{"attr_id": "cpu_count", "attr_name": "CPU核数", "attr_type": "int", "unit": "核"}],
    }
    service, _calls = _service(
        rows={
            "host": [
                {"inst_uuid": "h1", "cpu_count": 1},
                {"inst_uuid": "h2", "cpu_count": 1},
                {"inst_uuid": "h3", "cpu_count": 1},
            ],
            "vm": [{"inst_uuid": "v1", "cpu_count": 10}],
        },
        counts={"host": 3, "vm": 1},
    )
    metrics = [{"key": "cpu", "label": "CPU", "sources": ["host:cpu_count", "vm:cpu_count"]}]
    summed = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=[{**metrics[0], "func": "sum"}],
        permission_for=PERM,
    )
    assert summed["items"][0]["cpu"] == 13
    averaged = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=[{**metrics[0], "func": "avg"}],
        permission_for=PERM,
    )
    assert averaged["items"][0]["cpu"] == pytest.approx(3.25)
    assert "不是把各模型的平均值再平均" in averaged["fields"][2]["description"]
    minimum = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=[{**metrics[0], "func": "min"}],
        permission_for=PERM,
    )
    maximum = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=[{**metrics[0], "func": "max"}],
        permission_for=PERM,
    )
    counted = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=[{**metrics[0], "func": "count"}],
        permission_for=PERM,
    )
    assert minimum["items"][0]["cpu"] == 1
    assert maximum["items"][0]["cpu"] == 10
    assert counted["items"][0]["cpu"] == 4
    assert counted["items"][0]["model_id"] == "host,vm"


def test_unmatched_aggregate_is_not_labeled_unfilled():
    service, _calls = _service(
        rows={
            "host": [{"inst_uuid": "h", "cpu_count": 0, "capacity": ""}],
            "app": [{"inst_uuid": "a", "capacity": None}],
        },
        counts={"host": 1, "app": 1},
    )
    blocked = {
        "logic": "and",
        "children": [{"scope": "global", "sources": ["host:os_type"], "operator": "list_any[]", "value": ["2"]}],
    }
    result = _run(
        service,
        model_ids=["host", "app"],
        analysis_mode="aggregate",
        conditions=blocked,
        metrics=[{"key": "capacity_sum", "label": "容量", "func": "sum", "sources": ["app:capacity"]}],
    )
    app = next(row for row in result["items"] if row["model_id"] == "app")
    assert app["capacity_sum"] is None
    assert app["capacity_sum__applicability"] == "无匹配"
    blank = _run(
        service,
        model_ids=["host"],
        analysis_mode="aggregate",
        metrics=[{"key": "capacity_sum", "label": "容量", "func": "sum", "sources": ["host:capacity"]}],
    )
    assert blank["items"][0]["capacity_sum"] is None
    assert blank["items"][0]["capacity_sum__applicability"] == "空字符串"
    zero = _run(
        service,
        model_ids=["host"],
        analysis_mode="aggregate",
        metrics=[{"key": "cpu_sum", "label": "CPU", "func": "sum", "sources": ["host:cpu_count"]}],
    )
    assert zero["items"][0]["cpu_sum"] == 0
    assert zero["items"][0]["cpu_sum__applicability"] == "有效"
    missing = _run(
        service,
        model_ids=["app"],
        analysis_mode="aggregate",
        metrics=[{"key": "capacity_sum", "label": "容量", "func": "sum", "sources": ["app:capacity"]}],
    )
    assert missing["items"][0]["capacity_sum"] is None
    assert missing["items"][0]["capacity_sum__applicability"] == "未填写"


def test_graph_aggregation_is_not_capped_by_the_materialize_limit():
    service, calls = _service(counts={"host": 9000}, groups={"host": {"2": 8000, "3": 1000}})
    counted = _run(service, model_ids=["host"], analysis_mode="count")
    assert counted["items"][0]["count"] == 9000
    assert counted["items"][0]["scope_count"] == 9000
    distributed = _run(service, model_ids=["host"], analysis_mode="distribution", group_by="os_type")
    assert sum(row["count"] for row in distributed["items"]) == 9000
    assert all(call["page_size"] == 1 for call in calls["list"])
    paged = _run(service, model_ids=["host"], analysis_mode="list", page=2, page_size=20)
    assert paged["count"] == 9000
    assert calls["list"][-1]["page"] == 2
    assert calls["list"][-1]["page_size"] == 20


def test_same_model_or_union_cannot_bypass_the_materialize_limit():
    def list_instances(**kwargs):
        total = 3000
        marker = str(kwargs["params"])
        if kwargs["page_size"] == 1:
            return [{"inst_uuid": marker}], total
        base = 0 if "left" in marker else 3000
        return [{"inst_uuid": f"id-{base + index}", "cpu_count": 1} for index in range(total)], total

    service = CmdbInstanceQueryService(list_instances, lambda **kwargs: {})
    tree = {
        "logic": "or",
        "children": [
            {"scope": "host", "attr_id": "ip_addr", "operator": "str=", "value": "left"},
            {"scope": "host", "attr_id": "inst_name", "operator": "str=", "value": "right"},
        ],
    }
    with pytest.raises(ValueError, match=MATERIALIZE_LIMIT_MESSAGE):
        _run(
            service,
            model_ids=["host"],
            analysis_mode="aggregate",
            conditions=tree,
            metrics=[{"key": "cpu_sum", "label": "CPU", "func": "sum", "sources": ["host:cpu_count"]}],
        )


def test_mixed_metric_scopes_keep_their_own_rows():
    vm = {"model_id": "vm", "model_name": "虚拟机", "classification_id": "compute", "classification_name": "计算"}
    attrs = {
        "host": [
            {"attr_id": "cpu_count", "attr_name": "CPU核数", "attr_type": "int", "unit": "核"},
            {"attr_id": "capacity", "attr_name": "容量", "attr_type": "int", "unit": "GB"},
        ],
        "vm": [{"attr_id": "cpu_count", "attr_name": "CPU核数", "attr_type": "int", "unit": "核"}],
        "app": APP_ATTRS,
    }
    service, _calls = _service(
        rows={
            "host": [
                {"inst_uuid": "h1", "cpu_count": 4, "capacity": 8},
                {"inst_uuid": "h2", "cpu_count": 0, "capacity": ""},
                {"inst_uuid": "h3"},
            ],
            "vm": [{"inst_uuid": "v1", "cpu_count": 6}],
            "app": [{"inst_uuid": "a1", "capacity": 100}],
        },
        counts={"host": 3, "vm": 1, "app": 1},
    )
    result = service.run(
        models=[HOST, vm, APP],
        attrs_by_model=attrs,
        model_ids=["host", "vm", "app"],
        analysis_mode="aggregate",
        metrics=[
            {"key": "cpu_sum", "label": "CPU核数", "func": "sum", "sources": ["host:cpu_count", "vm:cpu_count"]},
            {"key": "capacity_sum", "label": "容量", "func": "sum", "sources": ["host:capacity"]},
            {"key": "host_count", "label": "主机数量", "func": "count", "sources": ["host:cpu_count"]},
        ],
        permission_for=PERM,
    )
    by_scope = {row["model_id"]: row for row in result["items"]}
    assert set(by_scope) == {"host", "host,vm"}
    assert "app" not in by_scope
    merged = by_scope["host,vm"]
    assert merged["model_name"] == "主机、虚拟机"
    assert merged["cpu_sum"] == 10
    assert merged["cpu_sum__applicability"] == "有效"
    assert merged["capacity_sum"] is None
    assert merged["capacity_sum__applicability"] == "不适用"
    assert merged["host_count"] is None
    host = by_scope["host"]
    assert host["model_name"] == "主机"
    assert host["capacity_sum"] == 8
    assert host["capacity_sum__applicability"] == "有效"
    assert host["cpu_sum"] is None
    assert host["cpu_sum__applicability"] == "不适用"
    assert host["host_count"] == 3
    assert host["host_count__applicability"] == "有效"
    titles = {field["key"]: field["title"] for field in result["fields"]}
    assert titles["model_id"] == "模型"
    assert titles["capacity_sum__applicability"] == "容量·口径"
    by_key = {field["key"]: field for field in result["fields"]}
    assert "未填写和空字符串的实例也计数" in by_key["host_count"]["description"]
    assert "不记成 0" not in by_key["host_count"]["description"]
    assert "不记成 0" in by_key["capacity_sum"]["description"]
    assert "真实 0 仍会计入" in by_key["cpu_sum"]["description"]
    assert "其他指标的范围不会把这一列带过去" in by_key["cpu_sum"]["description"]


def _os(options):
    return {"attr_id": "os_type", "attr_name": "系统类型", "attr_type": "enum", "enum_options": options}


def test_explicit_distribution_rejects_same_enum_id_with_different_meanings():
    vm = {"model_id": "vm", "model_name": "虚拟机", "classification_id": "compute", "classification_name": "计算"}
    attrs = {
        "host": [_os([{"id": "1", "name": "Linux"}])],
        "vm": [_os([{"id": "1", "name": "Windows"}, {"id": "9", "name": "Linux"}])],
    }
    service, calls = _service(groups={"host": {"1": 4}, "vm": {"1": 6, "9": 7}})
    with pytest.raises(ValueError, match="不能合并") as raised:
        service.run(
            models=[HOST, vm],
            attrs_by_model=attrs,
            model_ids=["host", "vm"],
            analysis_mode="distribution",
            group_by=[{"sources": ["host:os_type", "vm:os_type"], "label": "系统类型"}],
            permission_for=PERM,
        )
    message = str(raised.value)
    assert "枚举值 1" in message
    assert "主机 · 系统类型（Linux）" in message
    assert "虚拟机 · 系统类型（Windows）" in message
    assert calls["group"] == []
    alias = {
        "host": [_os([{"id": "1", "name": "Linux"}])],
        "vm": [_os([{"id": "1", "name": "linux"}])],
    }
    with pytest.raises(ValueError, match="不能合并"):
        service.run(
            models=[HOST, vm],
            attrs_by_model=alias,
            model_ids=["host", "vm"],
            analysis_mode="distribution",
            group_by=[{"sources": ["host:os_type", "vm:os_type"]}],
            permission_for=PERM,
        )
    missing = {
        "host": [_os([{"id": "1", "name": "Linux"}])],
        "vm": [_os([{"id": "1"}])],
    }
    with pytest.raises(ValueError, match="没有可核对的显示名"):
        service.run(
            models=[HOST, vm],
            attrs_by_model=missing,
            model_ids=["host", "vm"],
            analysis_mode="distribution",
            group_by=[{"sources": ["host:os_type", "vm:os_type"]}],
            permission_for=PERM,
        )
    undeclared = _service(groups={"host": {"9": 4}, "vm": {"9": 6}})
    with pytest.raises(ValueError, match="无法证明相同"):
        undeclared[0].run(
            models=[HOST, vm],
            attrs_by_model={
                "host": [_os([{"id": "1", "name": "Linux"}])],
                "vm": [_os([{"id": "1", "name": "Linux"}])],
            },
            model_ids=["host", "vm"],
            analysis_mode="distribution",
            group_by=[{"sources": ["host:os_type", "vm:os_type"]}],
            permission_for=PERM,
        )


def test_explicit_distribution_merges_only_compatible_enum_values():
    vm = {"model_id": "vm", "model_name": "虚拟机", "classification_id": "compute", "classification_name": "计算"}
    attrs = {
        "host": [_os([{"id": "2", "name": "Linux"}, {"id": "3", "name": "Windows"}]), {"attr_id": "name", "attr_name": "名称", "attr_type": "str"}],
        "vm": [_os([{"id": "2", "name": "Linux"}, {"id": "4", "name": "Linux"}]), {"attr_id": "name", "attr_name": "名称", "attr_type": "str"}],
        "app": APP_ATTRS,
    }
    service, calls = _service(
        counts={"host": 12, "vm": 11, "app": 9},
        groups={"host": {"2": 5, "3": 0, None: 2, "": 4}, "vm": {"2": 7, "4": 3, None: 1, "": 1}},
    )
    result = service.run(
        models=[HOST, vm, APP],
        attrs_by_model=attrs,
        model_ids=["host", "vm", "app"],
        analysis_mode="distribution",
        group_by=[{"sources": ["host:os_type", "vm:os_type"], "label": "系统类型"}],
        page=1,
        page_size=1,
        permission_for=PERM,
    )
    assert result["count"] == 5
    assert result["items"][0]["group_raw"] == "2"
    assert result["items"][0]["group_value"] == "Linux"
    assert result["items"][0]["count"] == 12
    assert " / " not in result["items"][0]["group_value"]
    full = service.run(
        models=[HOST, vm, APP],
        attrs_by_model=attrs,
        model_ids=["host", "vm", "app"],
        analysis_mode="distribution",
        group_by=[{"sources": ["host:os_type", "vm:os_type"], "label": "系统类型"}],
        page_size=20,
        permission_for=PERM,
    )
    by_raw = {row["group_raw"]: row for row in full["items"] if row["group_kind"] == "value"}
    assert by_raw["2"]["count"] == 12
    assert by_raw["4"]["group_value"] == "Linux"
    assert by_raw["4"]["count"] == 3
    assert by_raw["3"]["count"] == 0
    assert by_raw["2"]["group_raw"] != by_raw["4"]["group_raw"]
    empty = next(row for row in full["items"] if row["group_kind"] == "empty")
    unfilled = next(row for row in full["items"] if row["group_kind"] == "unfilled")
    assert empty["count"] == 5
    assert unfilled["count"] == 3
    assert all(row["model_id"] == "host,vm" for row in full["items"])
    assert "查询范围" in full["fields"][0]["description"]
    assert "不是这一桶实际贡献" in full["fields"][0]["description"]
    service_names, _name_calls = _service(groups={"host": {"web": 2, "010": 1}, "vm": {"web": 3, "10": 4}})
    merged_names = service_names.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="distribution",
        group_by=[{"sources": ["host:name", "vm:name"], "label": "名称"}],
        page_size=20,
        permission_for=PERM,
    )
    by_name = {row["group_raw"]: row["count"] for row in merged_names["items"]}
    assert by_name == {"web": 5, "010": 1, "10": 4}
    with pytest.raises(ValueError, match="类型或单位不一致"):
        service.run(
            models=[HOST, vm, APP],
            attrs_by_model=attrs,
            model_ids=["host", "vm", "app"],
            analysis_mode="distribution",
            group_by=[{"sources": ["host:os_type", "app:capacity"]}],
            permission_for=PERM,
        )
    assert all(call["params"][0]["value"] in {"host", "vm"} for call in calls["group"])


def test_distribution_scope_keeps_named_models_when_one_matches_nothing():
    vm = {"model_id": "vm", "model_name": "虚拟机", "classification_id": "compute", "classification_name": "计算"}
    attrs = {"host": [_os([{"id": "2", "name": "Linux"}])], "vm": [_os([{"id": "2", "name": "Linux"}])]}
    service, calls = _service(groups={"vm": {"2": 7}})
    result = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="distribution",
        conditions={"logic": "and", "children": [{"scope": "global", "sources": ["vm:os_type"], "operator": "list_any[]", "value": ["2"]}]},
        group_by=[{"sources": ["host:os_type", "vm:os_type"], "label": "系统类型"}],
        permission_for=PERM,
    )
    assert result["items"] == [
        {
            "model_id": "host,vm",
            "model_name": "主机、虚拟机",
            "field_key": "host_os_type__vm_os_type",
            "field_label": "系统类型",
            "group_value": "Linux",
            "group_raw": "2",
            "group_kind": "value",
            "count": 7,
        }
    ]
    assert result["fields"][0]["description"].startswith("这条分组点名的查询范围")
    assert all(call["params"][0]["value"] == "vm" for call in calls["group"])


def test_null_metric_sorts_last_and_zero_stays_in_order():
    from apps.cmdb.services.instance_query import _sort_rows

    vm = {"model_id": "vm", "model_name": "虚拟机", "classification_id": "compute", "classification_name": "计算"}
    attrs = {"host": HOST_ATTRS, "vm": [{"attr_id": "cpu_count", "attr_name": "CPU核数", "attr_type": "int", "unit": "核"}]}
    service, _calls = _service(
        rows={
            "host": [{"inst_uuid": "h1", "cpu_count": 10, "capacity": 0}, {"inst_uuid": "h2", "cpu_count": 0}],
            "vm": [{"inst_uuid": "v1", "cpu_count": 0}],
        },
        counts={"host": 2, "vm": 1},
    )
    metrics = [
        {"key": "cpu_avg", "label": "CPU", "func": "avg", "sources": ["host:cpu_count", "vm:cpu_count"]},
        {"key": "capacity_sum", "label": "容量", "func": "sum", "sources": ["host:capacity"]},
    ]
    first = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=metrics,
        order="-cpu_avg",
        page_size=1,
        permission_for=PERM,
    )
    assert first["count"] == 2
    assert first["items"][0]["model_id"] == "host,vm"
    assert first["items"][0]["cpu_avg"] == pytest.approx(10 / 3)
    assert first["items"][0]["cpu_avg__applicability"] == "有效"
    ascending = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=metrics,
        order="cpu_avg",
        page_size=1,
        permission_for=PERM,
    )
    assert ascending["items"][0]["model_id"] == "host,vm"
    ordered = [
        row["model_id"]
        for row in service.run(
            models=[HOST, vm],
            attrs_by_model=attrs,
            model_ids=["host", "vm"],
            analysis_mode="aggregate",
            metrics=metrics,
            order="-cpu_avg",
            page_size=20,
            permission_for=PERM,
        )["items"]
    ]
    assert ordered == ["host,vm", "host"]
    by_zero = service.run(
        models=[HOST, vm],
        attrs_by_model=attrs,
        model_ids=["host", "vm"],
        analysis_mode="aggregate",
        metrics=metrics,
        order="-capacity_sum",
        page_size=20,
        permission_for=PERM,
    )
    assert [row["model_id"] for row in by_zero["items"]] == ["host", "host,vm"]
    assert by_zero["items"][0]["capacity_sum"] == 0
    assert by_zero["items"][1]["capacity_sum"] is None
    numbers = [{"model_id": "host", "cpu": None}, {"model_id": "vm", "cpu": 0}, {"model_id": "app", "cpu": 5}]
    assert [row["model_id"] for row in _sort_rows(numbers, "-cpu")] == ["app", "vm", "host"]
    assert [row["model_id"] for row in _sort_rows(numbers, "cpu")] == ["vm", "app", "host"]
    with pytest.raises(ValueError, match="类型不一致"):
        _sort_rows([{"model_id": "a", "cpu": 1}, {"model_id": "b", "cpu": "x"}], "cpu")
    with pytest.raises(ValueError, match="无法排序"):
        _sort_rows([{"model_id": "a", "cpu": {"n": 1}}], "cpu")


def test_cross_model_detail_and_bucket_limits_fail_closed():
    service, _calls = _service(counts={"host": 3000, "app": 2500}, groups={"host": {str(index): 1 for index in range(MAX_BUCKETS + 1)}})
    with pytest.raises(ValueError, match=MATERIALIZE_LIMIT_MESSAGE):
        _run(service, model_ids=["host", "app"], analysis_mode="list")
    with pytest.raises(ValueError, match=BUCKET_LIMIT_MESSAGE):
        _run(service, model_ids=["host"], analysis_mode="distribution", group_by="os_type")
