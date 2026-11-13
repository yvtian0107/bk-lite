"""CMDB 通用查询：过滤、统计、排序和分页都在本模块完成。"""

from __future__ import annotations

import json
from typing import Any

from apps.cmdb.display_field.constants import DISPLAY_VALUES_SEPARATOR
from apps.cmdb.services.generic_query_graph import (
    GenericQueryGraphError,
    aggregate_numeric,
    count_instances,
    group_instance_counts,
    scan_instance_rows,
)
from apps.cmdb.services.generic_query_limits import DETAIL_PAGE_SIZE_MAX, NATS_MESSAGE_MAX_BYTES, SCAN_INSTANCE_MAX, STAT_GROUP_MAX
from apps.core.utils.condition_group import ConditionGroupError, parse_condition_group

MODEL_MODES = ("detail", "count", "distribution")
INSTANCE_MODES = ("detail", "count", "distribution", "aggregate")
ONE_HOP_MODES = ("detail", "count", "distribution")
MODEL_PAGE_SIZE_DEFAULT = 10
MODEL_SELECTION_MAX = 50
INSTANCE_SELECTION_MAX = 20
_MODEL_GROUP = "model"
_PLATFORM_SORT_FIELDS = ("inst_name", "inst_uuid", "model_id", "model_name")
_FILTER_TYPES = {
    ("string", "eq"): "str=",
    ("string", "ne"): "str<>",
    ("string", "contains"): "str*",
    ("string", "empty"): "empty",
    ("number", "eq"): "int=",
    ("number", "gt"): "int>",
    ("number", "gte"): "int>=",
    ("number", "lt"): "int<",
    ("number", "lte"): "int<=",
}
_ENUM_ATTR_TYPES = {"enum"}
_NUMBER_ATTR_TYPES = {"int", "integer", "float", "number", "long", "double"}


class GenericQueryError(Exception):
    def __init__(self, message: str, *, status: str = "failed"):
        super().__init__(message)
        self.message = message
        self.status = status


def _filled(value) -> bool:
    if value is None or value == "":
        return False
    if isinstance(value, (list, dict)) and not value:
        return False
    return True


def _reject_unused(mode: str, checks: list[tuple[Any, str, tuple[str, ...]]]) -> None:
    """当前分析方式用不到、但请求里写了值的参数直接拒绝。空值视为没填。"""
    blocked = [label for value, label, allowed in checks if mode not in allowed and _filled(value)]
    if blocked:
        raise GenericQueryError("当前分析方式不支持" + "、".join(blocked))


def ensure_payload_limit(data: Any) -> None:
    encoded = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
    if len(encoded) > NATS_MESSAGE_MAX_BYTES:
        raise GenericQueryError("结果超过 NATS 消息上限 1MB")


def id_list(value) -> list[str]:
    """单个字符串或字符串列表。不按逗号拆开，重复项只留第一次出现的位置。"""
    if value in (None, ""):
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (list, tuple)):
        found = []
        for item in value:
            if isinstance(item, (list, dict)) or item in (None, ""):
                continue
            text = str(item).strip()
            if text and text not in found:
                found.append(text)
        return found
    raise GenericQueryError("列表参数格式错误")


def parse_model_filters(filters, model_ids: list[str]) -> dict:
    """每个已选模型一块条件。没有公共条件，空块表示这个模型不过滤。"""
    if filters in (None, "", []):
        return {model_id: None for model_id in model_ids}
    if not isinstance(filters, dict) or set(filters) != {"by_model"} or not isinstance(filters.get("by_model"), dict):
        raise GenericQueryError("条件过滤格式错误")
    raw = filters["by_model"]
    unknown = [str(key) for key in raw if str(key) not in set(model_ids)]
    if unknown:
        raise GenericQueryError("条件过滤包含未选模型")
    parsed = {}
    for model_id in model_ids:
        group = raw.get(model_id)
        if group in (None, "", []):
            parsed[model_id] = None
            continue
        if not isinstance(group, (list, dict)):
            raise GenericQueryError("条件过滤格式错误")
        parsed[model_id] = group
    return parsed


def _select_model_rows(rows: list[dict], classification_id, model_ids, *, limit: int) -> list[dict]:
    """显式模型优先。分类只在没勾模型时扩大范围，勾了模型时只校验归属。"""
    by_id = {row["model_id"]: row for row in rows if row.get("model_id")}
    selected = id_list(model_ids)
    class_ids = set(id_list(classification_id))
    if len(selected) > limit:
        raise GenericQueryError(f"模型数量不能超过 {limit} 个")
    if selected:
        missing = [item for item in selected if item not in by_id]
        if missing:
            raise GenericQueryError("指定模型不存在或无权访问", status="forbidden")
        if class_ids:
            outside = [item for item in selected if by_id[item]["classification_id"] not in class_ids]
            if outside:
                raise GenericQueryError("模型不属于所选分类")
        return [by_id[item] for item in selected]
    if class_ids:
        return [row for row in rows if row["classification_id"] in class_ids]
    return rows


def query_models(
    *,
    models: list[dict],
    instance_counts: dict,
    analysis_mode: str,
    classification_id: str | list | None = None,
    model_ids: list[str] | None = None,
    page=None,
    page_size=None,
) -> dict:
    """模型查询。分类和模型只缩小范围，零实例模型保留。

    选了模型时只统计这些模型，分类不再把同类的其他模型加进来。
    只选分类时统计这些分类下的可见模型；都不选时统计全部可见模型。
    显式勾选的模型最多 50 个。单值固定为范围内模型数量。分布按实例数从高到低、
    模型标识升序稳定排序，不接受页码。未传每页条数时返回全部；传入时只取前若干条。
    计数不接受非空分页。
    """
    mode = _mode(analysis_mode, MODEL_MODES)
    if mode == "distribution" and page not in (None, ""):
        raise GenericQueryError("当前分析方式不支持页码")
    if mode == "count" and (page not in (None, "") or page_size not in (None, "")):
        raise GenericQueryError("当前分析方式不支持分页")
    rows = [_model_row(item, instance_counts) for item in models]
    rows = _select_model_rows(rows, classification_id, model_ids, limit=MODEL_SELECTION_MAX)
    scanned = sum(int(row["instance_count"]) for row in rows)
    if mode != "detail":
        _ensure_scan(scanned)
    if mode == "count":
        return _value_payload(
            len(rows),
            field="model_count",
            title="模型数",
            unit="个",
            aggregation="模型计数",
        )
    if mode == "distribution":
        # 分类和模型只缩小范围。每个可见模型一项，不再按分类把实例数加总。
        # 先完成全部统计和排序，再截取当前页。重名保留原始模型名称，身份看 model_id。
        items = _model_distribution_items(rows)
        _ensure_groups(len(items))
        items.sort(key=lambda item: (-int(item.get("instance_count") or 0), str(item.get("model_id") or "")))
        limit = _distribution_return_limit(page_size)
        page_items = items if limit is None else items[:limit]
        return _with_fields(
            {
                "structure": "category",
                "status": "empty" if not page_items else "ok",
                "items": page_items,
                "count": len(items),
                "page": 1,
                "page_size": len(items) if limit is None else limit,
                "unit": "个",
                "aggregation": "按模型统计权限内实例数，含零实例模型",
            },
            _MODEL_ROW_FIELDS,
        )
    rows.sort(
        key=lambda item: (
            str(item.get("classification_name") or ""),
            str(item.get("model_name") or ""),
            str(item.get("model_id") or ""),
        )
    )
    page_no, size = _model_page(page, page_size)
    paged = _page_payload(rows, page_no, size)
    paged["items"] = [_public_model_detail(row) for row in paged["items"]]
    return _with_fields(paged, _MODEL_ROW_FIELDS)


def query_instances(
    *,
    models: list[dict],
    analysis_mode: str,
    permission_map: dict,
    group_by: str | None = None,
    aggregate_field: str | None = None,
    aggregate_op: str | None = None,
    order: str | None = None,
    columns: list | None = None,
    page=None,
    page_size=None,
) -> dict:
    """多个模型的实例合在一次查询里。每个模型先套上自己的条件和权限，再取并集。"""
    specs = _instance_models(models)
    mode = _mode(analysis_mode, INSTANCE_MODES)
    _reject_unused(
        mode,
        [
            (group_by, "分布属性", ("distribution",)),
            (aggregate_field, "聚合属性", ("aggregate",)),
            (aggregate_op, "聚合方式", ("aggregate",)),
            (order, "排序", ("detail", "distribution")),
            (columns, "展示列", ("detail",)),
        ],
    )
    if mode == "distribution":
        return _instance_distribution(specs, permission_map, group_by, order, page, page_size)
    if mode == "count":
        _parse_page(page, page_size, enabled=False)
        total = _instance_total(specs, permission_map)
        return _value_payload(
            total,
            field="instance_count",
            title="实例数",
            unit="个",
            aggregation="实例计数",
        )
    if mode == "aggregate":
        _parse_page(page, page_size, enabled=False)
        return _instance_aggregate(specs, permission_map, aggregate_field, aggregate_op)
    return _instance_detail(specs, permission_map, columns, order, page, page_size)


def _instance_models(models: list[dict] | None) -> list[dict]:
    if not models:
        raise GenericQueryError("请勾选模型")
    specs = []
    seen = set()
    for item in models:
        if not isinstance(item, dict):
            raise GenericQueryError("模型参数格式错误")
        model_id = str(item.get("model_id") or "").strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        specs.append(
            {
                "model_id": model_id,
                "model_name": str(item.get("model_name") or model_id),
                "attr_types": dict(item.get("attr_types") or {}),
                "attrs": list(item.get("attrs") or []),
                "filters": item.get("filters"),
            }
        )
    if not specs:
        raise GenericQueryError("请勾选模型")
    if len(specs) > INSTANCE_SELECTION_MAX:
        raise GenericQueryError(f"模型数量不能超过 {INSTANCE_SELECTION_MAX} 个")
    return specs


def _model_conditions(model: dict) -> tuple[str, list]:
    return _attribute_filters(model["attr_types"], None, None, None, model.get("filters"))


def _base_params(model_id: str) -> list[dict]:
    return [{"field": "model_id", "type": "str=", "value": model_id}]


def _instance_total(models: list[dict], permission_map: dict) -> int:
    total = 0
    for model in models:
        logic, conditions = _model_conditions(model)
        try:
            total += count_instances(_base_params(model["model_id"]), permission_map, conditions, logic)
        except GenericQueryGraphError as exc:
            raise GenericQueryError(exc.message) from exc
    _ensure_scan(total)
    return total


def _reject_idle_filters(models: list[dict], active_id: str) -> None:
    for model in models:
        if model["model_id"] == active_id:
            continue
        _logic, conditions = _model_conditions(model)
        if conditions:
            raise GenericQueryError("其他模型不参与这次统计，不能带该模型的条件")


def _owned_attr(models: list[dict], key: str, purpose: str) -> tuple[dict, str]:
    text = str(key or "").strip()
    if "." not in text:
        raise GenericQueryError(f"不支持跨模型{purpose}")
    model_id, attr_id = text.split(".", 1)
    model = next((item for item in models if item["model_id"] == model_id), None)
    if model is None or not attr_id:
        raise GenericQueryError(f"不支持跨模型{purpose}")
    if str(model["attr_types"].get(attr_id) or "").lower() == "pwd":
        raise GenericQueryError(f"属性不存在或无权使用: {text}")
    _attr_kind(model["attr_types"], attr_id)
    return model, attr_id


def _unique_model_labels(models: list[dict]) -> dict[str, str]:
    names = [model["model_name"] for model in models]
    duplicated = {name for name in names if names.count(name) > 1}
    labels = {}
    for model in models:
        name = model["model_name"]
        labels[model["model_id"]] = f"{name}（{model['model_id']}）" if name in duplicated else name
    return labels


def _instance_distribution(models, permission_map, group_by, order, page, page_size) -> dict:
    limit = _distribution_window("distribution", page, page_size)
    grouped_model, attr_id = (None, None)
    if str(group_by or "").strip() not in ("", _MODEL_GROUP):
        grouped_model, attr_id = _owned_attr(models, str(group_by), "属性分组")
        _reject_idle_filters(models, grouped_model["model_id"])
    if grouped_model is None:
        counts = {}
        for model in models:
            logic, conditions = _model_conditions(model)
            try:
                counts[model["model_id"]] = count_instances(_base_params(model["model_id"]), permission_map, conditions, logic)
            except GenericQueryGraphError as exc:
                raise GenericQueryError(exc.message) from exc
        _ensure_scan(sum(counts.values()))
        labels = _unique_model_labels(models)
        items = [
            {
                "model_name": labels[model["model_id"]],
                "model_id": model["model_id"],
                "instance_count": int(counts.get(model["model_id"]) or 0),
            }
            for model in models
        ]
        _ensure_groups(len(items))
        field, descending = _parse_order(
            order,
            {"model_name", "model_id", "instance_count"},
            default="instance_count",
            default_descending=True,
        )
        _sort_distribution(items, field, descending)
        shown, window = _slice_distribution(items, limit)
        fields = [
            _result_field("model_name", "模型名称", "string", "dimension"),
            _result_field("model_id", "模型标识", "string", "identity"),
            _result_field("instance_count", "实例数", "number", "measure"),
        ]
        aggregation = "按模型统计权限内实例数"
    else:
        logic, conditions = _model_conditions(grouped_model)
        try:
            grouped_counts = group_instance_counts(
                attr_id,
                _base_params(grouped_model["model_id"]),
                permission_map,
                conditions,
                logic,
            )
        except GenericQueryGraphError as exc:
            raise GenericQueryError(exc.message) from exc
        _ensure_scan(sum(int(value or 0) for value in grouped_counts.values()))
        field_key = f"{grouped_model['model_id']}.{attr_id}"
        labels = _enum_labels(grouped_model["attrs"], attr_id)
        items = []
        for bucket in _distribution_items(field_key, grouped_counts, labels):
            items.append(
                {
                    "model_id": grouped_model["model_id"],
                    "model_name": grouped_model["model_name"],
                    field_key: bucket.get(field_key),
                    "instance_count": bucket["instance_count"],
                }
            )
        _ensure_groups(len(items))
        field, descending = _parse_order(
            order,
            {field_key, "instance_count", "model_name", "model_id"},
            default="instance_count",
            default_descending=True,
        )
        _sort_distribution(items, field, descending)
        shown, window = _slice_distribution(items, limit)
        title = _attr_title(grouped_model, attr_id, len(models))
        fields = [
            _result_field("model_name", "模型名称", "string"),
            _result_field("model_id", "模型标识", "string", "identity"),
            _result_field(
                field_key,
                title,
                _declared_value_type(grouped_model["attr_types"], attr_id),
                "dimension",
            ),
            _result_field("instance_count", "实例数", "number", "measure"),
        ]
        aggregation = f"按 {grouped_model['model_name']} · {title if len(models) == 1 else _attr_title(grouped_model, attr_id, 1)} 计数"
    if not shown:
        return _with_fields(
            {
                "structure": "category",
                "status": "empty",
                "items": [],
                "unit": "个",
                "aggregation": aggregation,
                **window,
            },
            fields,
        )
    return _category_payload(shown, unit="个", aggregation=aggregation, fields=fields, extra=window)


def _instance_aggregate(models, permission_map, aggregate_field, aggregate_op) -> dict:
    if not aggregate_field or not aggregate_op:
        raise GenericQueryError("数值聚合必须指定聚合字段和聚合方式")
    model, attr_id = _owned_attr(models, str(aggregate_field), "属性聚合")
    if _attr_kind(model["attr_types"], attr_id) != "number":
        raise GenericQueryError("聚合字段不是数值属性")
    _reject_idle_filters(models, model["model_id"])
    logic, conditions = _model_conditions(model)
    try:
        aggregated = aggregate_numeric(
            attr_id,
            aggregate_op,
            _base_params(model["model_id"]),
            permission_map,
            condition_params=conditions,
            condition_logic=logic,
        )
    except GenericQueryGraphError as exc:
        raise GenericQueryError(exc.message) from exc
    scanned = int(aggregated.get("scanned") or 0)
    valued = int(aggregated.get("valued") or 0)
    _ensure_scan(scanned)
    field_key = f"{model['model_id']}.{attr_id}"
    fields = [
        _result_field("aggregate_value", "聚合值", "number", "measure"),
        _result_field("aggregate_field", "聚合属性", "string"),
        _result_field("scanned_count", "扫描实例数", "number"),
        _result_field("valued_count", "有值个数", "number"),
    ]
    title = _attr_title(model, attr_id, len(models))
    payload = {
        "structure": "value",
        "aggregate_field": field_key,
        "aggregate_label": title,
        "scanned_count": scanned,
        "valued_count": valued,
        "unit": "",
        "aggregation": f"{aggregate_op}({title})",
    }
    if scanned == 0:
        payload.update({"status": "empty", "aggregate_value": None})
    elif valued == 0:
        payload.update({"status": "missing", "aggregate_value": None})
    else:
        payload.update({"status": "ok", "aggregate_value": aggregated.get("value")})
    return _with_fields(payload, fields)


def _instance_detail(models, permission_map, columns, order, page, page_size) -> dict:
    selected = _selected_columns(models, columns)
    allowed = set(_PLATFORM_SORT_FIELDS)
    allowed.update(column["key"] for column in _all_attr_columns(models))
    field, descending = _parse_order(order, allowed, default="inst_name")
    sort_attr = _column_by_key(models, field)
    collected = []
    room = SCAN_INSTANCE_MAX
    for model in models:
        logic, conditions = _model_conditions(model)
        fields = ["inst_uuid", "inst_name", "model_id"]
        for column in selected:
            if column["model_id"] == model["model_id"]:
                fields.append(column["attr_id"])
                if column.get("display_key"):
                    fields.append(column["display_attr"])
        if sort_attr and sort_attr["model_id"] == model["model_id"]:
            fields.append(sort_attr["attr_id"])
        try:
            batch = scan_instance_rows(
                _base_params(model["model_id"]),
                permission_map,
                fields,
                condition_params=conditions,
                condition_logic=logic,
                limit=room + 1,
            )
        except GenericQueryGraphError as exc:
            raise GenericQueryError(exc.message) from exc
        if len(batch) > room:
            _ensure_scan(SCAN_INSTANCE_MAX + 1)
        room -= len(batch)
        for raw in batch:
            collected.append(_detail_row(model, raw, selected))
    _sort_detail_rows(collected, field, descending)
    paged = _page_payload(collected, page, page_size)
    paged["column_fields"] = _detail_column_fields(models, selected)
    return _with_fields(paged, _detail_result_fields(models, selected))


def _selected_columns(models: list[dict], columns) -> list[dict]:
    chosen = []
    for key in id_list(columns):
        column = _column_by_key(models, key)
        if column is None:
            raise GenericQueryError(f"属性不存在或无权使用: {key}")
        if column["key"] not in {item["key"] for item in chosen}:
            chosen.append(column)
    return chosen


def _all_attr_columns(models: list[dict]) -> list[dict]:
    columns = []
    for model in models:
        for attr in model["attrs"] or []:
            column = _column_from_attr(model, attr, len(models))
            if column:
                columns.append(column)
    return columns


def _column_by_key(models: list[dict], key: str) -> dict | None:
    if key in _PLATFORM_SORT_FIELDS or "." not in str(key):
        return None
    model_id, attr_id = str(key).split(".", 1)
    model = next((item for item in models if item["model_id"] == model_id), None)
    if model is None:
        return None
    attr = next((item for item in model["attrs"] or [] if str(item.get("attr_id") or "") == attr_id), None)
    if attr is None and attr_id in model["attr_types"]:
        attr = {"attr_id": attr_id, "attr_name": attr_id, "attr_type": model["attr_types"][attr_id]}
    if not isinstance(attr, dict):
        return None
    return _column_from_attr(model, attr, len(models))


def _column_from_attr(model: dict, attr: dict, model_count: int) -> dict | None:
    from apps.cmdb.services.generic_query_columns import candidate_field as build_candidate_field

    field = build_candidate_field(attr)
    if field is None:
        return None
    attr_id = field["key"]
    copied = dict(field)
    copied["model_id"] = model["model_id"]
    copied["attr_id"] = attr_id
    copied["key"] = f"{model['model_id']}.{attr_id}"
    copied["title"] = _attr_title(model, attr_id, model_count, fallback=field["title"])
    copied["default_visible"] = True
    if copied.get("display_key"):
        copied["display_attr"] = copied["display_key"]
        copied["display_key"] = f"{model['model_id']}.{copied['display_attr']}"
    return copied


def _attr_title(model: dict, attr_id: str, model_count: int, fallback: str | None = None) -> str:
    attr = next((item for item in model["attrs"] or [] if str(item.get("attr_id") or "") == attr_id), None)
    name = str((attr or {}).get("attr_name") or fallback or attr_id)
    if model_count > 1 and not name.startswith(f"{model['model_name']} · "):
        return f"{model['model_name']} · {name}"
    return name


def _enum_labels(attrs: list, attr_id: str) -> dict[str, str] | None:
    attr = next((item for item in attrs or [] if str(item.get("attr_id") or "") == attr_id), None)
    if not isinstance(attr, dict) or str(attr.get("attr_type") or "").lower() != "enum":
        return None
    from apps.cmdb.services.model import ModelManage

    labels = {}
    for option in ModelManage.resolve_runtime_enum_options(attr) or []:
        if not isinstance(option, dict) or option.get("id") in (None, ""):
            continue
        labels[str(option.get("id"))] = str(option.get("name") or option.get("label") or option.get("id"))
    return labels


def _detail_row(model: dict, raw: dict, columns: list[dict]) -> dict:
    row = {
        "model_name": model["model_name"],
        "model_id": model["model_id"],
        "inst_name": None if not isinstance(raw, dict) or "inst_name" not in raw else raw.get("inst_name"),
        "inst_uuid": None if not isinstance(raw, dict) or "inst_uuid" not in raw else raw.get("inst_uuid"),
    }
    if isinstance(raw, dict) and raw.get("model_id"):
        row["model_id"] = str(raw.get("model_id"))
    for column in columns:
        if column["model_id"] != model["model_id"]:
            row[column["key"]] = None
            if column.get("display_key"):
                row[column["display_key"]] = None
            continue
        present = isinstance(raw, dict) and column["attr_id"] in raw
        row[column["key"]] = raw.get(column["attr_id"]) if present else None
        if column.get("display_key"):
            display_attr = column.get("display_attr")
            row[column["display_key"]] = raw.get(display_attr) if isinstance(raw, dict) and display_attr in raw else None
    row["_sort_model_id"] = model["model_id"]
    return row


def _sort_detail_rows(rows: list[dict], field: str, descending: bool) -> None:
    def read(row):
        if field == "model_id":
            return row.get("_sort_model_id")
        return row.get(field)

    def tie(row):
        return (str(row.get("_sort_model_id") or ""), str(row.get("inst_uuid") or ""))

    present = [row for row in rows if read(row) is not None]
    missing = [row for row in rows if read(row) is None]
    present.sort(key=tie)
    present.sort(key=read, reverse=descending)
    missing.sort(key=tie)
    rows[:] = present + missing
    for row in rows:
        row.pop("_sort_model_id", None)


def _sort_distribution(items: list[dict], field: str, descending: bool) -> None:
    def tie(item):
        return (str(item.get("model_id") or ""), str(item.get(field) or ""))

    present = [item for item in items if item.get(field) is not None]
    missing = [item for item in items if item.get(field) is None]
    present.sort(key=tie)
    present.sort(key=lambda item: item.get(field), reverse=descending)
    missing.sort(key=lambda item: str(item.get("model_id") or ""))
    items[:] = present + missing


def _detail_column_fields(models: list[dict], columns: list[dict]) -> dict:
    from apps.cmdb.services.generic_query_columns import plain_field as build_plain_field

    fields = [
        build_plain_field("model_name", "模型名称", default_visible=True),
        build_plain_field("model_id", "模型标识", default_visible=True),
        build_plain_field("inst_name", "实例名称", default_visible=True),
        build_plain_field("inst_uuid", "实例标识", default_visible=True),
    ]
    fields.extend(columns)
    return {
        "source": "model_attrs",
        "model_key": "|".join(model["model_id"] for model in models),
        "fields": fields,
    }


def _detail_result_fields(models: list[dict], columns: list[dict]) -> list[dict]:
    fields = [
        _result_field("model_name", "模型名称", "string"),
        _result_field("model_id", "模型标识", "string", "identity"),
        _result_field("inst_name", "实例名称", "string"),
        _result_field("inst_uuid", "实例标识", "string", "identity"),
    ]
    for column in columns:
        fields.append(_result_field(column["key"], column["title"], _column_value_type(column)))
    return fields


def _column_value_type(column: dict) -> str:
    raw = str(column.get("attr_type") or "").lower()
    if raw in _NUMBER_ATTR_TYPES:
        return "number"
    if raw in {"bool", "boolean"}:
        return "boolean"
    return "string"


_ONE_HOP_RELATION_AGGREGATION = "起点内去重后的对应关系条数。同一起点关联多个终点时分别计数，同一个终点被多个起点关联时不合并"
_ONE_HOP_RANK_AGGREGATION = "按起点统计关联数量。同一起点到同一终点只计 1，不同起点连到同一终点时分别计数"


def one_hop_query_plan(analysis_mode: str | None, page, page_size) -> dict:
    """定下图查询要取的那一块。明细按起点、终点名称翻页，分布按关联数取前几名。"""
    mode = _mode(analysis_mode, ONE_HOP_MODES)
    if mode == "count":
        _parse_page(page, page_size, enabled=False)
        return {"part": "count"}
    if mode == "distribution":
        return {"part": "distribution", "limit": _distribution_window(mode, page, page_size)}
    page_no, size = _parse_page(page, page_size, enabled=True)
    return {"part": "detail", "skip": (page_no - 1) * size, "limit": size}


def query_one_hop_relations(
    *,
    analysis_mode: str,
    graph_result: dict,
    page=None,
    page_size=None,
) -> dict:
    """一跳关联：计数是对应关系条数，分布是每个起点的关联数量。"""
    mode = _mode(analysis_mode, ONE_HOP_MODES)
    distribution_limit = _distribution_window(mode, page, page_size) if mode == "distribution" else None
    if mode == "count":
        _parse_page(page, page_size, enabled=False)
    graph_result = graph_result or {}
    pair_count = int(graph_result.get("pair_count") or 0)
    if mode == "count":
        return _value_payload(
            pair_count,
            field="relation_count",
            title="关联数",
            unit="个",
            aggregation=_ONE_HOP_RELATION_AGGREGATION,
        )
    if mode == "distribution":
        items = [
            {
                "start_name": item.get("start_name") or "",
                "start_uuid": item.get("start_uuid") or "",
                "relation_count": int(item.get("relation_count", item.get("value")) or 0),
            }
            for item in graph_result.get("groups") or []
        ]
        total = int(graph_result["group_count"]) if "group_count" in graph_result else len(items)
        _ensure_groups(total)
        items.sort(key=lambda item: (-(item.get("relation_count") or 0), item.get("start_uuid") or ""))
        if "group_count" in graph_result:
            shown = items
            window = {
                "count": total,
                "page": 1,
                "page_size": total if distribution_limit is None else distribution_limit,
            }
        else:
            shown, window = _slice_distribution(items, distribution_limit)
        distribution_fields = [
            _result_field("start_name", "起点名称", "string", "dimension"),
            _result_field("start_uuid", "起点标识", "string", "identity"),
            _result_field("relation_count", "关联数", "number", "measure"),
        ]
        if not shown:
            return _with_fields(
                {
                    "structure": "category",
                    "status": "empty",
                    "items": [],
                    "unit": "个",
                    "aggregation": _ONE_HOP_RANK_AGGREGATION,
                    **window,
                },
                distribution_fields,
            )
        return _category_payload(
            shown,
            unit="个",
            aggregation=_ONE_HOP_RANK_AGGREGATION,
            fields=distribution_fields,
            extra=window,
        )
    rows = [
        {
            "start_uuid": item.get("start_uuid") or "",
            "start_name": item.get("start_name") or "",
            "start_model_id": item.get("start_model_id") or "",
            "end_uuid": item.get("end_uuid") or "",
            "end_name": item.get("end_name") or "",
            "end_model_id": item.get("end_model_id") or "",
        }
        for item in graph_result.get("pairs") or []
    ]
    if graph_result.get("paged"):
        return _page_payload(rows, page, page_size, count=pair_count)
    rows.sort(
        key=lambda item: (
            item.get("start_name") or "",
            item.get("end_name") or "",
            item.get("start_uuid") or "",
            item.get("end_uuid") or "",
        )
    )
    return _page_payload(rows, page, page_size)


def _enum_membership_values(value, *, split_commas: bool) -> list[str]:
    """枚举入库统一是 id 列表。等于、不等于、属于都按成员关系比较。"""
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    if value in (None, ""):
        return []
    text = str(value)
    if split_commas:
        return [part.strip() for part in text.split(",") if part.strip()]
    return [text]


def build_attribute_filter(attr_types: dict[str, str], field: str | None, op: str | None, value) -> dict | None:
    if field in (None, "") and op in (None, "") and value in (None, ""):
        return None
    if field in (None, "") or op in (None, ""):
        raise GenericQueryError("属性过滤必须同时给出字段和运算符")
    kind = _attr_kind(attr_types, field)
    if kind == "enum":
        if op not in {"eq", "ne", "in"}:
            raise GenericQueryError("属性过滤运算符不受支持")
        selected = _enum_membership_values(value, split_commas=op == "in")
        if not selected:
            raise GenericQueryError("属性过滤必须给出值")
        return {
            "field": field,
            "type": "list_none[]" if op == "ne" else "list_any[]",
            "value": selected,
        }
    mapped = _FILTER_TYPES.get((kind, op))
    if mapped is None:
        raise GenericQueryError("属性过滤运算符不受支持")
    if op == "empty":
        return {"field": field, "type": mapped}
    if value in (None, "") or (isinstance(value, list) and not value):
        raise GenericQueryError("属性过滤必须给出值")
    parsed = value
    if kind == "number":
        parsed = _as_number(value)
    if op == "in":
        if not isinstance(parsed, list):
            parsed = [part.strip() for part in str(value).split(",") if part.strip()]
        if not parsed:
            raise GenericQueryError("属性过滤必须给出值")
    return {"field": field, "type": mapped, "value": parsed}


def _attribute_filters(attr_types, field, op, value, filters) -> tuple[str, list]:
    try:
        logic, items = parse_condition_group(filters)
    except ConditionGroupError as exc:
        raise GenericQueryError(exc.message) from exc
    single = build_attribute_filter(attr_types, field, op, value)
    group = []
    for item in items:
        parsed = build_attribute_filter(attr_types, item.get("field"), item.get("op"), item.get("value"))
        if parsed:
            group.append(parsed)
    if single and group and logic == "OR":
        raise GenericQueryError("属性过滤不能同时使用旧字段和 OR 条件组")
    if single:
        return "AND", [single, *group]
    return logic, group


compile_attribute_conditions = _attribute_filters


def _result_field(key: str, title: str, value_type: str, role: str | None = None) -> dict:
    field = {"key": key, "title": title, "value_type": value_type}
    if role:
        field["role"] = role
    return field


_MODEL_ROW_FIELDS = [
    _result_field("classification_name", "分类", "string"),
    _result_field("model_name", "模型名称", "string", "dimension"),
    _result_field("model_id", "模型标识", "string", "identity"),
    _result_field("instance_count", "实例数", "number", "measure"),
]


def _with_fields(payload: dict, fields: list[dict]) -> dict:
    payload["fields"] = fields
    return payload


def _model_row(model: dict, counts: dict) -> dict:
    model_id = str(model.get("model_id") or "")
    return {
        "model_id": model_id,
        "model_name": model.get("model_name") or model_id,
        "classification_id": str(model.get("classification_id") or ""),
        "classification_name": model.get("classification_name") or "",
        "instance_count": int(counts.get(model_id, 0) or 0),
    }


def _public_model_detail(row: dict) -> dict:
    """明细只返回模型定义上的四列。分布使用同一组业务键，不另造 name/value。"""
    return {
        "classification_name": row.get("classification_name") or "",
        "model_name": row.get("model_name") or "",
        "model_id": row.get("model_id") or "",
        "instance_count": int(row.get("instance_count") or 0),
    }


def _model_distribution_items(rows: list[dict]) -> list[dict]:
    return [_public_model_detail(row) for row in rows]


def _bucket_value(key):
    """分组键保留 0、false 和空串。只有缺失分组才是 None。"""
    if key is None:
        return None
    if isinstance(key, bool) or isinstance(key, (int, float)):
        return key
    return str(key)


def _distribution_items(group_field: str, grouped_counts: dict, group_labels: dict[str, str] | None) -> list[dict]:
    """枚举分布按选项名称出分类，同一名称的计数合并。其他类型保持原分组键。"""
    merged: dict[Any, int] = {}
    for key, value in grouped_counts.items():
        presented = _present_group_value(key, group_labels)
        merged[presented] = merged.get(presented, 0) + int(value or 0)
    return [{group_field: key, "instance_count": count} for key, count in merged.items()]


def _present_group_value(key, group_labels: dict[str, str] | None):
    if group_labels is None:
        return _bucket_value(key)
    if key is None:
        return None
    parts = _enum_id_parts(key)
    if parts is None:
        return group_labels.get(str(key), str(key))
    names = [group_labels.get(str(part), str(part)) for part in parts if part not in (None, "")]
    return DISPLAY_VALUES_SEPARATOR.join(names)


def _enum_id_parts(key):
    if isinstance(key, list):
        return key
    if isinstance(key, str) and key.startswith("["):
        try:
            parsed = json.loads(key)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            return parsed
    return None


def _declared_value_type(attr_types: dict[str, str], field: str) -> str:
    kind = _attr_kind(attr_types, field) if field in attr_types else "string"
    if kind == "number":
        return "number"
    raw = str(attr_types.get(field) or "").lower()
    if raw in {"bool", "boolean"}:
        return "boolean"
    return "string"


def _attr_kind(attr_types: dict[str, str], field: str) -> str:
    if field not in attr_types:
        raise GenericQueryError(f"属性不存在或无权使用: {field}")
    raw = str(attr_types.get(field) or "string").lower()
    if raw in _ENUM_ATTR_TYPES:
        return "enum"
    if raw in _NUMBER_ATTR_TYPES:
        return "number"
    return "string"


def _mode(value: str | None, allowed: tuple[str, ...]) -> str:
    mode = str(value or "").strip()
    if mode not in allowed:
        raise GenericQueryError("分析方式不受支持")
    return mode


def _ensure_scan(scanned: int) -> None:
    if scanned > SCAN_INSTANCE_MAX:
        raise GenericQueryError(f"统计范围超过 {SCAN_INSTANCE_MAX} 个实例")


def _ensure_groups(count: int) -> None:
    if count > STAT_GROUP_MAX:
        raise GenericQueryError(f"统计分组超过 {STAT_GROUP_MAX} 组")


def _parse_order(
    order: str | None,
    allowed: set[str],
    *,
    default: str,
    default_descending: bool | None = None,
) -> tuple[str, bool]:
    text = str(order or "").strip()
    if not text:
        if default_descending is None:
            default_descending = default == "value"
        return default, default_descending
    descending = text.startswith("-")
    field = text[1:] if descending else text
    if field not in allowed:
        raise GenericQueryError(f"不支持的排序字段: {field}")
    return field, descending


def _distribution_window(mode: str, page, page_size) -> int | None:
    """分布不接受页码。返回条数空着表示全部，写了就取排序后的前几条。"""
    del mode
    if page not in (None, ""):
        raise GenericQueryError("当前分析方式不支持页码")
    return _distribution_return_limit(page_size)


def _slice_distribution(items: list, limit: int | None) -> tuple[list, dict]:
    total = len(items)
    shown = items if limit is None else items[:limit]
    return shown, {"count": total, "page": 1, "page_size": total if limit is None else limit}


def _distribution_return_limit(page_size) -> int | None:
    """分布只看返回条数。页码不读。空条数表示全部，显式条数仍受每页上限约束。"""
    if page_size in (None, ""):
        return None
    size = _as_int(page_size, "page_size")
    if size < 1 or size > DETAIL_PAGE_SIZE_MAX:
        raise GenericQueryError(f"每页最多 {DETAIL_PAGE_SIZE_MAX} 条")
    return size


def _model_page(page, page_size) -> tuple[int, int]:
    page_no = 1 if page in (None, "") else _as_int(page, "page")
    size = MODEL_PAGE_SIZE_DEFAULT if page_size in (None, "") else _as_int(page_size, "page_size")
    if page_no < 1:
        raise GenericQueryError("page 必须大于 0")
    if size < 1 or size > DETAIL_PAGE_SIZE_MAX:
        raise GenericQueryError(f"每页最多 {DETAIL_PAGE_SIZE_MAX} 条")
    return page_no, size


def _parse_page(page, page_size, *, enabled: bool) -> tuple[int, int]:
    if not enabled:
        if page not in (None, "") or page_size not in (None, ""):
            raise GenericQueryError("当前分析方式不支持分页")
        return 1, DETAIL_PAGE_SIZE_MAX
    page_no = 1 if page in (None, "") else _as_int(page, "page")
    size = 20 if page_size in (None, "") else _as_int(page_size, "page_size")
    if page_no < 1:
        raise GenericQueryError("page 必须大于 0")
    if size < 1 or size > DETAIL_PAGE_SIZE_MAX:
        raise GenericQueryError(f"每页最多 {DETAIL_PAGE_SIZE_MAX} 条")
    return page_no, size


def _page_payload(rows: list, page, page_size, *, count: int | None = None) -> dict:
    page_no, size = _parse_page(page, page_size, enabled=True)
    total = len(rows) if count is None else count
    if count is None:
        start = (page_no - 1) * size
        rows = rows[start : start + size]
    return {
        "structure": "table",
        "status": "empty" if total == 0 else "ok",
        "items": rows,
        "count": total,
        "page": page_no,
        "page_size": size,
    }


def _value_payload(
    value,
    *,
    field: str,
    title: str,
    unit: str,
    aggregation: str,
    extra: dict | None = None,
    fields: list[dict] | None = None,
) -> dict:
    payload = {
        "structure": "value",
        "status": "ok",
        field: value,
        "unit": unit,
        "aggregation": aggregation,
    }
    if extra:
        payload.update(extra)
    return _with_fields(payload, fields or [_result_field(field, title, "number", "measure")])


def _category_payload(items: list[dict], *, unit: str, aggregation: str, fields: list[dict], extra: dict | None = None) -> dict:
    payload = {
        "structure": "category",
        "status": "ok",
        "items": items,
        "unit": unit,
        "aggregation": aggregation,
    }
    if extra:
        payload.update(extra)
    return _with_fields(payload, fields)


def load_instances_by_uuids(uuids: list[str]) -> list[dict]:
    """按已授权的实例标识补齐一跳端点属性。空列表不访问图库。"""
    unique = []
    seen = set()
    for value in uuids or []:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    if not unique:
        return []
    from apps.cmdb.graph.drivers.graph_client import GraphClient

    with GraphClient() as client:
        return client.query_entity_by_inst_uuids(unique) or []


def _as_int(value, name: str) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError
        return int(value)
    except (TypeError, ValueError) as exc:
        raise GenericQueryError(f"{name} 必须是整数") from exc


def _as_number(value):
    try:
        if isinstance(value, bool):
            raise ValueError
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise GenericQueryError("筛选值必须是数值") from exc
    if number.is_integer():
        return int(number)
    return number
