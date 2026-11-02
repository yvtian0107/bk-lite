"""仅本地验收的级联选项 mock。

运行时只由 ``get_source_data`` 在 NATS 路径上、``rest_api`` 前缀为 ``demo/`` 时调用。
REST / Excel 不吃声明参，不能把这套数据做成那两类数据源。
"""

PATH_MONITOR_OBJECTS = "accept_monitor_objects"
PATH_METRICS = "accept_metrics"
PATH_INSTANCES = "accept_instances"
PATH_METRICS_B = "accept_metrics_b"
PATH_DETAILS = "accept_details"
PATH_CASCADE_CHART = "accept_cascade_chart"
PATH_CASCADE_CHART_B = "accept_cascade_chart_b"
PATH_CASCADE_CHART_PARAMS = "accept_cascade_chart_params"

REST_MONITOR_OBJECTS = f"demo/{PATH_MONITOR_OBJECTS}"
REST_METRICS = f"demo/{PATH_METRICS}"
REST_INSTANCES = f"demo/{PATH_INSTANCES}"
REST_METRICS_B = f"demo/{PATH_METRICS_B}"
REST_DETAILS = f"demo/{PATH_DETAILS}"
REST_CASCADE_CHART = f"demo/{PATH_CASCADE_CHART}"
REST_CASCADE_CHART_B = f"demo/{PATH_CASCADE_CHART_B}"
REST_CASCADE_CHART_PARAMS = f"demo/{PATH_CASCADE_CHART_PARAMS}"

ACCEPTANCE_MARK = "仅本地验收"
DEFAULT_NAMESPACE_NAME = "默认命名空间"
TAG_MONITOR = "monitor"
TAG_OTHER = "other"
ACCEPTANCE_TAG_IDS = (TAG_MONITOR, TAG_OTHER)
CHART_TYPES = ["line", "bar", "table", "single", "multiValue"]

_OPTION_FIELDS = [
    {"key": "id", "title": "值", "value_type": "string"},
    {"key": "name", "title": "名称", "value_type": "string"},
]

_CHART_FIELDS = [
    {"key": "name", "title": "名称", "value_type": "string"},
    {"key": "value", "title": "示意值", "value_type": "number"},
    {"key": "object_id", "title": "监控对象", "value_type": "string"},
    {"key": "metric_id", "title": "指标", "value_type": "string"},
    {"key": "instance_id", "title": "实例", "value_type": "string"},
]

_MONITOR_OBJECTS = (
    {"id": "obj-a", "name": "对象A"},
    {"id": "obj-b", "name": "对象B"},
)

# 指标宇宙 A。空 object_id 不回退到全量。
_METRICS = {
    "obj-a": (
        {"id": "m1", "name": "指标1"},
        {"id": "m2", "name": "指标2"},
    ),
    "obj-b": ({"id": "m3", "name": "指标3"},),
}

# 指标宇宙 B：入参仍是 object_id，候选项与 A 不重叠，用来验收异源拆行。
_METRICS_B = {
    "obj-a": (
        {"id": "mb1", "name": "指标B1"},
        {"id": "mb2", "name": "指标B2"},
    ),
    "obj-b": ({"id": "mb3", "name": "指标B3"},),
}

# (object_id, metric_id) → 实例。缺任一入参返回空列表。
_INSTANCES = {
    ("obj-a", "m1"): (
        {"id": "inst-a1", "name": "实例A1"},
        {"id": "inst-a1b", "name": "实例A1-2"},
    ),
    ("obj-a", "m2"): ({"id": "inst-a2", "name": "实例A2"},),
    ("obj-b", "m3"): ({"id": "inst-b3", "name": "实例B3"},),
}

# instance_id → 明细。空 instance_id 不回退到全量，只给超 3 级链验收用。
_DETAILS = {
    "inst-a1": (
        {"id": "d-a1-1", "name": "明细A1-1"},
        {"id": "d-a1-2", "name": "明细A1-2"},
    ),
    "inst-a1b": ({"id": "d-a1b", "name": "明细A1-2"},),
    "inst-a2": ({"id": "d-a2", "name": "明细A2"},),
    "inst-b3": ({"id": "d-b3", "name": "明细B3"},),
}


def _text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple)):
        if len(value) != 1:
            return ""
        return _text(value[0])
    return str(value).strip()


def _copy_rows(rows):
    return [dict(item) for item in rows]


def _objects(_params):
    return _copy_rows(_MONITOR_OBJECTS)


def _metrics_for(table, params):
    object_id = _text(params.get("object_id"))
    if not object_id:
        return []
    return _copy_rows(table.get(object_id, ()))


def _metrics(params):
    return _metrics_for(_METRICS, params)


def _metrics_b(params):
    return _metrics_for(_METRICS_B, params)


def _instances(params):
    object_id = _text(params.get("object_id"))
    metric_id = _text(params.get("metric_id"))
    if not object_id or not metric_id:
        return []
    return _copy_rows(_INSTANCES.get((object_id, metric_id), ()))


def _details(params):
    instance_id = _text(params.get("instance_id"))
    if not instance_id:
        return []
    return _copy_rows(_DETAILS.get(instance_id, ()))


def _chart(params):
    return [
        {
            "name": "级联示意",
            "value": 1,
            "object_id": _text(params.get("object_id")),
            "metric_id": _text(params.get("metric_id")),
            "instance_id": _text(params.get("instance_id")),
        }
    ]


_HANDLERS = {
    PATH_MONITOR_OBJECTS: _objects,
    PATH_METRICS: _metrics,
    PATH_INSTANCES: _instances,
    PATH_METRICS_B: _metrics_b,
    PATH_DETAILS: _details,
    PATH_CASCADE_CHART: _chart,
    PATH_CASCADE_CHART_B: _chart,
    PATH_CASCADE_CHART_PARAMS: _chart,
}


def get_demo_source_data(path, params):
    """按 path + params 返回 ``{result, data: {items}}``。未知 path 返回 None。"""
    handler = _HANDLERS.get(path)
    if handler is None:
        return None
    request_params = params if isinstance(params, dict) else {}
    return {"result": True, "data": {"items": handler(request_params)}}


def _request_param(name, alias_name):
    return {
        "name": name,
        "type": "string",
        "value": "",
        "alias_name": alias_name,
        "filterType": "params",
    }


def _select_param(name, alias_name, rest_api, filter_type):
    # 图表壳只声明选项源。上游引用由总表配置写入，不预置 {ref}。
    return {
        "name": name,
        "type": "string",
        "value": "",
        "alias_name": alias_name,
        "filterType": filter_type,
        "inputConfig": {
            "control": "select",
            "optionsSource": {
                "type": "dynamic",
                "sourceRef": {"type": "rest_api", "value": rest_api},
                "valueField": "id",
                "labelField": "name",
            },
        },
    }


def _filter_param(name, alias_name, rest_api):
    return _select_param(name, alias_name, rest_api, "filter")


def _component_param(name, alias_name, rest_api):
    return _select_param(name, alias_name, rest_api, "params")


def _spec(name, rest_api, desc, params, chart_type, field_schema, tag_ids=ACCEPTANCE_TAG_IDS):
    return {
        "name": name,
        "rest_api": rest_api,
        "desc": f"{ACCEPTANCE_MARK}。{desc}",
        "params": params,
        "chart_type": chart_type,
        "field_schema": field_schema,
        "tag_ids": tuple(tag_ids),
    }


# 名称是界面可见名。种子命令按 rest_api 幂等写入，不进内置目录。
ACCEPTANCE_DATASOURCE_SPECS = (
    _spec(
        "验收·监控对象（选项）",
        REST_MONITOR_OBJECTS,
        "无参选项列表，供级联第一级使用，本身不出图。",
        [],
        [],
        _OPTION_FIELDS,
    ),
    _spec(
        "验收·指标列表（选项）",
        REST_METRICS,
        "入参 object_id。obj-a 返回 m1/m2，obj-b 返回 m3；空 object_id 返回空列表。本身不出图。",
        [_request_param("object_id", "监控对象")],
        [],
        _OPTION_FIELDS,
    ),
    _spec(
        "验收·实例列表（选项）",
        REST_INSTANCES,
        "入参 object_id 与 metric_id，按组合过滤；缺任一入参返回空列表。本身不出图。",
        [
            _request_param("object_id", "监控对象"),
            _request_param("metric_id", "指标"),
        ],
        [],
        _OPTION_FIELDS,
    ),
    _spec(
        "验收·指标列表 B（选项）",
        REST_METRICS_B,
        "入参与指标列表相同，候选项是另一套宇宙，用来验收异源同名拆行。本身不出图。",
        [_request_param("object_id", "监控对象")],
        [],
        _OPTION_FIELDS,
    ),
    _spec(
        "验收·明细列表（选项）",
        REST_DETAILS,
        "入参 instance_id，按实例过滤明细。对象→指标→实例→明细会超过 3 级，用来验收拒存；本身不出图。",
        [_request_param("instance_id", "实例")],
        [],
        _OPTION_FIELDS,
    ),
    _spec(
        "验收·级联指标图",
        REST_CASCADE_CHART,
        "图表壳。三个筛选分别指向监控对象、指标列表、实例列表；取数固定返回一行示意。",
        [
            _filter_param("object_id", "监控对象", REST_MONITOR_OBJECTS),
            _filter_param("metric_id", "指标", REST_METRICS),
            _filter_param("instance_id", "实例", REST_INSTANCES),
        ],
        list(CHART_TYPES),
        _CHART_FIELDS,
    ),
    _spec(
        "验收·级联指标图 B",
        REST_CASCADE_CHART_B,
        "图表壳。三个同名筛选分别指向监控对象、指标列表 B、实例列表；不预置查询引用；取数固定返回一行示意。",
        [
            _filter_param("object_id", "监控对象", REST_MONITOR_OBJECTS),
            _filter_param("metric_id", "指标", REST_METRICS_B),
            _filter_param("instance_id", "实例", REST_INSTANCES),
        ],
        list(CHART_TYPES),
        _CHART_FIELDS,
    ),
    _spec(
        "验收·级联指标图（组件参）",
        REST_CASCADE_CHART_PARAMS,
        "图表壳。四个查询参数分别指向监控对象、指标列表、实例列表、明细列表，不预置查询引用；取数固定返回一行示意。",
        [
            _component_param("object_id", "监控对象", REST_MONITOR_OBJECTS),
            _component_param("metric_id", "指标", REST_METRICS),
            _component_param("instance_id", "实例", REST_INSTANCES),
            _component_param("detail_id", "明细", REST_DETAILS),
        ],
        list(CHART_TYPES),
        _CHART_FIELDS,
    ),
)
