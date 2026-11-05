import pytest

from apps.cmdb.services.instance_query import MAX_KEY_ATTRS, MAX_PAGE_SIZE, CmdbInstanceQueryService

HOST_ATTRS = [
    {"attr_id": "ip_addr", "attr_name": "内网IP", "attr_type": "str", "is_required": True},
    {"attr_id": "os_type", "attr_name": "系统类型", "attr_type": "enum", "enum_select_mode": "single"},
    {"attr_id": "cpu_count", "attr_name": "CPU核数", "attr_type": "int"},
    {"attr_id": "enabled", "attr_name": "启用", "attr_type": "bool"},
    {"attr_id": "weight", "attr_name": "权重", "attr_type": "float"},
    {"attr_id": "organization", "attr_name": "组织", "attr_type": "organization", "is_required": True},
    {"attr_id": "ip_display", "attr_name": "IP展示", "attr_type": "str", "is_display_field": True},
    {"attr_id": "node_id", "attr_name": "节点", "attr_type": "str", "is_system_link": True},
]


def _service(rows=None, count=None, groups=None):
    calls = []
    group_calls = []

    def list_instances(**kwargs):
        calls.append(kwargs)
        payload = rows if rows is not None else []
        total = len(payload) if count is None else count
        return payload, total

    def group_counts(**kwargs):
        group_calls.append(kwargs)
        return {} if groups is None else groups

    return CmdbInstanceQueryService(list_instances, group_counts), calls, group_calls


def test_missing_model_fails_before_query():
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match="请选择模型"):
        service.run(model_id="  ", analysis_mode="count", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls == []
    assert group_calls == []


def test_missing_analysis_mode_fails_before_query():
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match="请选择分析方式"):
        service.run(model_id="host", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls == []
    assert group_calls == []


@pytest.mark.parametrize("mode", ["list", "count", "distribution", "aggregate"])
def test_empty_permission_does_not_query(mode):
    service, calls, group_calls = _service([{"inst_uuid": "u1", "inst_name": "web", "model_id": "host"}], groups={"linux": 3})
    with pytest.raises(ValueError, match="无权查询实例"):
        service.run(model_id="host", analysis_mode=mode, group_by="os_type", attrs=HOST_ATTRS, permission_map={})
    with pytest.raises(ValueError, match="无权查询实例"):
        service.run(model_id="host", analysis_mode=mode, attrs=HOST_ATTRS, permission_map=None)
    assert calls == []
    assert group_calls == []


def test_filters_then_sorts_and_pages_the_requested_model():
    service, calls, group_calls = _service(
        [
            {
                "inst_uuid": "u1",
                "inst_name": "web",
                "model_id": "host",
                "ip_addr": "10.0.0.8",
                "cpu_count": 4,
                "_id": 9,
                "secret": "nope",
            }
        ],
        count=30,
    )
    result = service.run(
        model_id="host",
        analysis_mode="list",
        attrs=HOST_ATTRS,
        attr_filters="ip_addr=10.0.0.8;cpu_count=4;enabled=true;os_type=linux",
        order="-inst_name",
        page=2,
        page_size=5,
        permission_map={1: {"inst_names": ["web"]}},
        creator="alice",
    )

    assert calls == [
        {
            "model_id": "host",
            "params": [
                {"field": "ip_addr", "type": "str=", "value": "10.0.0.8"},
                {"field": "cpu_count", "type": "int=", "value": 4},
                {"field": "enabled", "type": "bool", "value": True},
                {"field": "os_type", "type": "str=", "value": "linux"},
            ],
            "page": 2,
            "page_size": 5,
            "order": "-inst_name",
            "permission_map": {1: {"inst_names": ["web"]}},
            "creator": "alice",
        }
    ]
    assert group_calls == []
    assert result["count"] == 30
    assert result["items"] == [
        {
            "inst_uuid": "u1",
            "inst_name": "web",
            "model_id": "host",
            "ip_addr": "10.0.0.8",
            "os_type": "",
            "cpu_count": 4,
            "enabled": "",
            "weight": "",
        }
    ]
    assert "_id" not in result["items"][0]
    assert "secret" not in result["items"][0]
    assert [field["key"] for field in result["fields"]] == [
        "inst_uuid",
        "inst_name",
        "model_id",
        "ip_addr",
        "os_type",
        "cpu_count",
        "enabled",
        "weight",
    ]


def test_empty_rows_keep_field_structure():
    service, calls, group_calls = _service([], count=0)
    result = service.run(model_id="host", analysis_mode="list", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls[0]["params"] == []
    assert calls[0]["order"] == "inst_name"
    assert calls[0]["page"] == 1
    assert group_calls == []
    assert result["items"] == []
    assert result["count"] == 0
    assert [field["key"] for field in result["fields"]][:3] == ["inst_uuid", "inst_name", "model_id"]
    assert "ip_addr" in {field["key"] for field in result["fields"]}


def test_count_uses_filtered_total_for_the_selected_model():
    service, calls, group_calls = _service([{"inst_name": "only-this-page"}], count=30)
    result = service.run(
        model_id="host",
        analysis_mode="count",
        attrs=HOST_ATTRS,
        attr_filters="os_type=linux",
        page=1,
        page_size=5,
        permission_map={1: {"inst_names": ["web"]}},
        creator="alice",
    )
    assert group_calls == []
    assert calls[0]["model_id"] == "host"
    assert calls[0]["page"] == 1
    assert calls[0]["page_size"] == 1
    assert calls[0]["params"] == [{"field": "os_type", "type": "str=", "value": "linux"}]
    assert calls[0]["permission_map"] == {1: {"inst_names": ["web"]}}
    assert result["count"] == 1
    assert result["items"] == [{"model_id": "host", "count": 30}]
    assert [field["key"] for field in result["fields"]] == ["model_id", "count"]

    later = service.run(
        model_id="host",
        analysis_mode="count",
        attrs=HOST_ATTRS,
        page=2,
        page_size=1,
        permission_map={1: {}},
    )
    assert later["items"] == []
    assert later["count"] == 1
    assert [field["key"] for field in later["fields"]] == ["model_id", "count"]


def test_distribution_filters_then_sorts_and_pages_groups():
    service, calls, group_calls = _service(groups={"linux": 2, "windows": 5, None: 1})
    result = service.run(
        model_id="host",
        analysis_mode="distribution",
        attrs=HOST_ATTRS,
        attr_filters="enabled=true",
        group_by="os_type",
        page=2,
        page_size=1,
        permission_map={1: {"inst_names": ["web"]}},
        creator="alice",
    )
    assert calls == []
    assert group_calls == [
        {
            "group_by_attr": "os_type",
            "permissions_map": {1: {"inst_names": ["web"]}},
            "params": [
                {"field": "model_id", "type": "str=", "value": "host"},
                {"field": "enabled", "type": "bool", "value": True},
            ],
            "creator": "alice",
        }
    ]
    assert result["count"] == 3
    assert result["items"] == [{"model_id": "host", "group_value": "linux", "count": 2}]
    assert [field["key"] for field in result["fields"]] == ["model_id", "group_value", "count"]
    assert result["fields"][1]["title"] == "系统类型"


def test_distribution_empty_groups_keep_fields():
    service, calls, group_calls = _service(groups={})
    result = service.run(
        model_id="host",
        analysis_mode="distribution",
        attrs=HOST_ATTRS,
        group_by="os_type",
        permission_map={1: {}},
    )
    assert calls == []
    assert group_calls[0]["params"][0] == {"field": "model_id", "type": "str=", "value": "host"}
    assert result["items"] == []
    assert result["count"] == 0
    assert [field["key"] for field in result["fields"]] == ["model_id", "group_value", "count"]


@pytest.mark.parametrize("mode", ["aggregate", "sum", "avg", "min", "max"])
def test_numeric_aggregation_fails_without_query(mode):
    service, calls, group_calls = _service(groups={"linux": 1})
    with pytest.raises(ValueError, match="数值聚合暂不支持"):
        service.run(
            model_id="host",
            analysis_mode=mode,
            attrs=HOST_ATTRS,
            agg_field="cpu_count",
            agg_func="sum",
            permission_map={1: {}},
        )
    assert calls == []
    assert group_calls == []


def test_unknown_analysis_mode_fails_without_query():
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match="不支持的分析方式"):
        service.run(model_id="host", analysis_mode="top", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls == []
    assert group_calls == []


def test_distribution_requires_group_field():
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match="需要填写分组字段"):
        service.run(model_id="host", analysis_mode="distribution", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls == []
    assert group_calls == []


def test_group_or_agg_fields_are_not_ignored_on_list():
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match="不使用分组字段"):
        service.run(model_id="host", analysis_mode="list", group_by="os_type", attrs=HOST_ATTRS, permission_map={1: {}})
    with pytest.raises(ValueError, match="不使用聚合字段"):
        service.run(model_id="host", analysis_mode="count", agg_field="cpu_count", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls == []
    assert group_calls == []


def test_count_rejects_detail_sort():
    service, calls, group_calls = _service([], count=4)
    with pytest.raises(ValueError, match="不支持按 inst_name 排序"):
        service.run(model_id="host", analysis_mode="count", order="inst_name", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls == []
    assert group_calls == []


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("ip_addr!=10.0.0.1", "仅支持等值"),
        ("ip_addr>10", "仅支持等值"),
        ("name~web", "仅支持等值"),
        ("missing=1", "不存在"),
        ("model_id=nginx", "不能改查其他模型"),
        ("ip_addr=1;ip_addr=2", "重复"),
        ("weight=1.5", "暂不支持"),
        ("organization=1", "暂不支持"),
        (["ip_addr=1"], "必须是字符串"),
    ],
)
def test_unsupported_filters_fail_closed(raw, message):
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match=message):
        service.run(model_id="host", analysis_mode="list", attrs=HOST_ATTRS, attr_filters=raw, permission_map={1: {}})
    assert calls == []
    assert group_calls == []


def test_multiple_enum_filter_fails():
    attrs = [{"attr_id": "tags", "attr_name": "标签枚举", "attr_type": "enum", "enum_select_mode": "multiple"}]
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match="多选枚举"):
        service.run(model_id="host", analysis_mode="count", attrs=attrs, attr_filters="tags=a", permission_map={1: {}})
    assert calls == []
    assert group_calls == []


@pytest.mark.parametrize("order", ["not_a_field", "organization", "ip_addr,inst_name", "-secret", 1])
def test_unsupported_order_fails(order):
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match="排序"):
        service.run(model_id="host", analysis_mode="list", attrs=HOST_ATTRS, order=order, permission_map={1: {}})
    assert calls == []
    assert group_calls == []


def test_page_size_over_limit_fails():
    service, calls, group_calls = _service()
    with pytest.raises(ValueError, match="不能超过"):
        service.run(
            model_id="host",
            analysis_mode="distribution",
            group_by="os_type",
            attrs=HOST_ATTRS,
            page_size=MAX_PAGE_SIZE + 1,
            permission_map={1: {}},
        )
    assert calls == []
    assert group_calls == []


def test_key_display_fields_prefer_identity_attrs_and_stay_bounded():
    attrs = [{"attr_id": f"opt_{index}", "attr_name": f"可选{index}", "attr_type": "str"} for index in range(MAX_KEY_ATTRS + 2)]
    attrs.append({"attr_id": "serial", "attr_name": "序列号", "attr_type": "str", "is_only": True})
    service, _calls, _group_calls = _service([], count=0)
    result = service.run(model_id="host", analysis_mode="list", attrs=attrs, permission_map={1: {}})
    keys = [field["key"] for field in result["fields"]]
    assert keys[:4] == ["inst_uuid", "inst_name", "model_id", "serial"]
    assert len(keys) == 3 + MAX_KEY_ATTRS
    assert "opt_13" not in keys
