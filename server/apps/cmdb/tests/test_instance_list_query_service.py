import pytest

from apps.cmdb.services.instance_list_query import MAX_KEY_ATTRS, MAX_PAGE_SIZE, CmdbInstanceListService

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


def _service(rows=None, count=None):
    calls = []

    def list_instances(**kwargs):
        calls.append(kwargs)
        payload = rows if rows is not None else []
        total = len(payload) if count is None else count
        return payload, total

    return CmdbInstanceListService(list_instances), calls


def test_missing_model_fails_before_query():
    service, calls = _service()
    with pytest.raises(ValueError, match="请选择模型"):
        service.run(model_id="  ", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls == []


def test_empty_permission_does_not_query():
    service, calls = _service([{"inst_uuid": "u1", "inst_name": "web", "model_id": "host"}])
    with pytest.raises(ValueError, match="无权查询实例"):
        service.run(model_id="host", attrs=HOST_ATTRS, permission_map={})
    with pytest.raises(ValueError, match="无权查询实例"):
        service.run(model_id="host", attrs=HOST_ATTRS, permission_map=None)
    assert calls == []


def test_filters_then_sorts_and_pages_the_requested_model():
    service, calls = _service(
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
    service, calls = _service([], count=0)
    result = service.run(model_id="host", attrs=HOST_ATTRS, permission_map={1: {}})
    assert calls[0]["params"] == []
    assert calls[0]["order"] == "inst_name"
    assert calls[0]["page"] == 1
    assert result["items"] == []
    assert result["count"] == 0
    assert [field["key"] for field in result["fields"]][:3] == ["inst_uuid", "inst_name", "model_id"]
    assert "ip_addr" in {field["key"] for field in result["fields"]}


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
    service, calls = _service()
    with pytest.raises(ValueError, match=message):
        service.run(model_id="host", attrs=HOST_ATTRS, attr_filters=raw, permission_map={1: {}})
    assert calls == []


def test_multiple_enum_filter_fails():
    attrs = [{"attr_id": "tags", "attr_name": "标签枚举", "attr_type": "enum", "enum_select_mode": "multiple"}]
    service, calls = _service()
    with pytest.raises(ValueError, match="多选枚举"):
        service.run(model_id="host", attrs=attrs, attr_filters="tags=a", permission_map={1: {}})
    assert calls == []


@pytest.mark.parametrize("order", ["not_a_field", "organization", "ip_addr,inst_name", "-secret", 1])
def test_unsupported_order_fails(order):
    service, calls = _service()
    with pytest.raises(ValueError, match="排序"):
        service.run(model_id="host", attrs=HOST_ATTRS, order=order, permission_map={1: {}})
    assert calls == []


def test_page_size_over_limit_fails():
    service, calls = _service()
    with pytest.raises(ValueError, match="不能超过"):
        service.run(model_id="host", attrs=HOST_ATTRS, page_size=MAX_PAGE_SIZE + 1, permission_map={1: {}})
    assert calls == []


def test_key_display_fields_prefer_identity_attrs_and_stay_bounded():
    attrs = [{"attr_id": f"opt_{index}", "attr_name": f"可选{index}", "attr_type": "str"} for index in range(MAX_KEY_ATTRS + 2)]
    attrs.append({"attr_id": "serial", "attr_name": "序列号", "attr_type": "str", "is_only": True})
    service, _calls = _service([], count=0)
    result = service.run(model_id="host", attrs=attrs, permission_map={1: {}})
    keys = [field["key"] for field in result["fields"]]
    assert keys[:4] == ["inst_uuid", "inst_name", "model_id", "serial"]
    assert len(keys) == 3 + MAX_KEY_ATTRS
    assert "opt_13" not in keys
