import pytest

from apps.cmdb.services.instance_query import (
    BUCKET_LIMIT_MESSAGE,
    MATERIALIZE_LIMIT_MESSAGE,
    MAX_BUCKETS,
    MAX_PAGE_SIZE,
    MAX_SCAN,
    CmdbInstanceQueryService,
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


def test_empty_scope_means_authorized_models_and_permission_failure_is_explicit():
    service, calls = _service(counts={"host": 2, "app": 5})
    result = _run(service, analysis_mode="count")
    assert {row["model_id"] for row in result["items"]} == {"host", "app"}
    assert result["items"][0]["scope_count"] == 7
    classified = _run(service, classification_ids=["biz"], analysis_mode="count")
    assert [row["model_id"] for row in classified["items"]] == ["app"]
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


def test_cross_model_detail_and_bucket_limits_fail_closed():
    service, _calls = _service(counts={"host": 3000, "app": 2500}, groups={"host": {str(index): 1 for index in range(MAX_BUCKETS + 1)}})
    with pytest.raises(ValueError, match=MATERIALIZE_LIMIT_MESSAGE):
        _run(service, model_ids=["host", "app"], analysis_mode="list")
    with pytest.raises(ValueError, match=BUCKET_LIMIT_MESSAGE):
        _run(service, model_ids=["host"], analysis_mode="distribution", group_by="os_type")
