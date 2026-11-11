"""CMDB 通用查询：过滤、统计、排序和分页都在本模块完成。"""

from __future__ import annotations

import json
from typing import Any

from apps.cmdb.graph.validators import CQLValidator
from apps.cmdb.services.generic_query_graph import GenericQueryGraphError, aggregate_numeric, count_by_attr
from apps.cmdb.services.generic_query_limits import (
    DETAIL_PAGE_SIZE_MAX,
    NATS_MESSAGE_MAX_BYTES,
    ONE_HOP_RESULT_MAX,
    ONE_HOP_START_MAX,
    SCAN_INSTANCE_MAX,
    STAT_GROUP_MAX,
)
from apps.cmdb.services.instance import InstanceManage
from apps.core.exceptions.base_app_exception import BaseAppException
from apps.core.utils.condition_group import ConditionGroupError, parse_condition_group

MODEL_MODES = ("detail", "count", "distribution")
INSTANCE_MODES = ("detail", "count", "distribution", "aggregate")
ONE_HOP_MODES = ("detail", "count", "distribution")

_RESULT_OPS = {
    "gt": lambda left, right: left > right,
    "gte": lambda left, right: left >= right,
    "eq": lambda left, right: left == right,
    "lt": lambda left, right: left < right,
    "lte": lambda left, right: left <= right,
    "ne": lambda left, right: left != right,
}
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
    ("enum", "eq"): "str=",
    ("enum", "ne"): "str<>",
    ("enum", "in"): "str[]",
}
_ENUM_ATTR_TYPES = {"enum"}
_NUMBER_ATTR_TYPES = {"int", "integer", "float", "number", "long", "double"}


class GenericQueryError(Exception):
    def __init__(self, message: str, *, status: str = "failed"):
        super().__init__(message)
        self.message = message
        self.status = status


def ensure_payload_limit(data: Any) -> None:
    encoded = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
    if len(encoded) > NATS_MESSAGE_MAX_BYTES:
        raise GenericQueryError("结果超过 NATS 消息上限 1MB")


def query_models(
    *,
    models: list[dict],
    instance_counts: dict,
    analysis_mode: str,
    classification_id: str | None = None,
    model_ids: list[str] | None = None,
    result_op: str | None = None,
    result_value=None,
    result_filter=None,
    order: str | None = None,
    page=None,
    page_size=None,
) -> dict:
    """模型查询。零实例模型保留为 0；统计超过扫描上限时失败。"""
    mode = _mode(analysis_mode, MODEL_MODES)
    if mode != "detail":
        _parse_page(page, page_size, enabled=False)
    rows = [_model_row(item, instance_counts) for item in models]
    if classification_id:
        rows = [row for row in rows if row["classification_id"] == classification_id]
    if model_ids:
        selected = set(model_ids)
        found = {row["model_id"] for row in rows}
        missing = [item for item in model_ids if item not in found]
        if missing:
            raise GenericQueryError("指定模型不存在或无权访问", status="forbidden")
        rows = [row for row in rows if row["model_id"] in selected]
    scanned = sum(int(row["instance_count"]) for row in rows)
    if mode != "detail":
        _ensure_scan(scanned)
    rows = _apply_result_filter(rows, result_op, result_value, result_filter)
    if mode == "count":
        return _value_payload(len(rows), unit="个", aggregation="模型计数")
    if mode == "distribution":
        # 分类和模型只缩小范围。每个可见模型一项，不再按分类把实例数加总。
        items = _model_distribution_items(rows)
        _ensure_groups(len(items))
        field, desc = _parse_order(order, {"name", "value"}, default="value")
        items.sort(key=lambda item: (item.get(field) is None, item.get(field)), reverse=desc)
        return _category_payload(items, unit="个", aggregation="按模型统计权限内实例数，含零实例模型")
    field, desc = _parse_order(
        order,
        {"model_name", "model_id", "classification_name", "instance_count"},
        default="model_name",
    )
    rows.sort(key=lambda item: (item.get(field) is None, item.get(field)), reverse=desc)
    paged = _page_payload(rows, page, page_size)
    paged["items"] = [_public_model_detail(row) for row in paged["items"]]
    return paged


def query_instances(
    *,
    model_id: str,
    analysis_mode: str,
    attr_types: dict[str, str],
    permission_map: dict,
    filter_field: str | None = None,
    filter_op: str | None = None,
    filter_value=None,
    filters=None,
    group_by: str | None = None,
    aggregate_field: str | None = None,
    aggregate_op: str | None = None,
    order: str | None = None,
    page=None,
    page_size=None,
) -> dict:
    if not str(model_id or "").strip():
        raise GenericQueryError("模型不能为空")
    mode = _mode(analysis_mode, INSTANCE_MODES)
    if mode != "detail":
        _parse_page(page, page_size, enabled=False)
    base_params = [{"field": "model_id", "type": "str=", "value": str(model_id)}]
    logic, condition_params = _attribute_filters(attr_types, filter_field, filter_op, filter_value, filters)
    if mode == "detail":
        page_no, size = _parse_page(page, page_size, enabled=True)
        field, desc = _parse_order(order, set(attr_types) | {"inst_name", "inst_uuid"}, default="inst_name")
        _validate_sort_field(field)
        order_text = f"-{field}" if desc else field
        items, count = InstanceManage.instance_list(
            model_id=str(model_id),
            params=[],
            page=page_no,
            page_size=size,
            order=order_text,
            permission_map=permission_map,
            condition_params=condition_params,
            condition_logic=logic,
        )
        rows = [_public_instance(item) for item in items or []]
        return _page_payload(rows, page_no, size, count=int(count or 0))

    if mode == "aggregate":
        if not aggregate_field or not aggregate_op:
            raise GenericQueryError("数值聚合必须指定聚合字段和聚合方式")
        attr_type = _attr_kind(attr_types, aggregate_field)
        if attr_type != "number":
            raise GenericQueryError("聚合字段不是数值属性")
        try:
            aggregated = aggregate_numeric(
                aggregate_field,
                aggregate_op,
                base_params,
                permission_map,
                condition_params=condition_params,
                condition_logic=logic,
            )
        except GenericQueryGraphError as exc:
            raise GenericQueryError(exc.message) from exc
        _ensure_scan(int(aggregated.get("scanned") or 0))
        if int(aggregated.get("scanned") or 0) == 0:
            return {
                "structure": "value",
                "status": "empty",
                "value": None,
                "unit": "",
                "aggregation": aggregate_op,
                "field": aggregate_field,
            }
        return _value_payload(
            aggregated.get("value"),
            unit="",
            aggregation=f"{aggregate_op}({aggregate_field})",
        )

    grouped_counts = count_by_attr(
        "model_id" if mode == "count" else _group_field(attr_types, group_by),
        base_params,
        permission_map,
        condition_params=condition_params,
        condition_logic=logic,
    )
    scanned = sum(int(value or 0) for value in grouped_counts.values())
    _ensure_scan(scanned)
    if mode == "count":
        return _value_payload(scanned, unit="个", aggregation="实例计数")
    items = [{"name": "" if key is None else str(key), "value": int(value or 0)} for key, value in grouped_counts.items()]
    _ensure_groups(len(items))
    field, desc = _parse_order(order, {"name", "value"}, default="value")
    items.sort(key=lambda item: (item.get(field) is None, item.get(field)), reverse=desc)
    if not items:
        return {"structure": "category", "status": "empty", "items": [], "unit": "个", "aggregation": f"按 {group_by} 计数"}
    return _category_payload(items, unit="个", aggregation=f"按 {group_by} 计数")


def query_one_hop_relations(
    *,
    analysis_mode: str,
    start_instances: list[dict],
    start_total: int,
    graph_result: dict,
    order: str | None = None,
    page=None,
    page_size=None,
) -> dict:
    """一跳结果按起点计数：同一起点落在多个终点时，各终点各计 1，各柱之和等于合计。"""
    mode = _mode(analysis_mode, ONE_HOP_MODES)
    if mode != "detail":
        _parse_page(page, page_size, enabled=False)
    if start_total > ONE_HOP_START_MAX:
        raise GenericQueryError(f"一跳关联起点超过 {ONE_HOP_START_MAX} 个")
    pair_count = int((graph_result or {}).get("pair_count") or 0)
    if pair_count > ONE_HOP_RESULT_MAX:
        raise GenericQueryError(f"一跳关联结果超过 {ONE_HOP_RESULT_MAX} 条")
    groups = graph_result.get("groups") or []
    pairs = graph_result.get("pairs") or []
    if mode == "count":
        return _value_payload(pair_count, unit="个", aggregation="按起点计数，同一起点关联多个终点时分别计数")
    if mode == "distribution":
        items = [
            {
                "name": item.get("end_name") or item.get("end_uuid") or "",
                "end_uuid": item.get("end_uuid") or "",
                "value": int(item.get("value") or 0),
            }
            for item in groups
        ]
        _ensure_groups(len(items))
        if len(items) > ONE_HOP_RESULT_MAX:
            raise GenericQueryError(f"一跳关联结果超过 {ONE_HOP_RESULT_MAX} 条")
        field, desc = _parse_order(order, {"name", "value"}, default="value")
        items.sort(key=lambda item: (item.get(field) is None, item.get(field)), reverse=desc)
        if not items:
            return {
                "structure": "category",
                "status": "empty",
                "items": [],
                "unit": "个",
                "aggregation": "按终点统计起点数，不做全局去重",
            }
        return _category_payload(items, unit="个", aggregation="按终点统计起点数，不做全局去重")
    rows = [
        {
            "start_uuid": item.get("start_uuid") or "",
            "start_name": item.get("start_name") or "",
            "start_model_id": item.get("start_model_id") or "",
            "end_uuid": item.get("end_uuid") or "",
            "end_name": item.get("end_name") or "",
            "end_model_id": item.get("end_model_id") or "",
        }
        for item in pairs
    ]
    field, desc = _parse_order(
        order,
        {"start_name", "start_uuid", "end_name", "end_uuid"},
        default="start_name",
    )
    rows.sort(key=lambda item: (item.get(field) is None, item.get(field)), reverse=desc)
    del start_instances
    return _page_payload(rows, page, page_size)


def load_start_instances(
    *,
    model_id: str,
    params: list,
    permission_map: dict,
    page: int,
    page_size: int,
    condition_params: list | None = None,
    condition_logic: str = "AND",
):
    _validate_sort_field("inst_name")
    return InstanceManage.instance_list(
        model_id=model_id,
        params=list(params),
        page=page,
        page_size=page_size,
        order="inst_name",
        permission_map=permission_map,
        condition_params=condition_params,
        condition_logic=condition_logic,
    )


def build_attribute_filter(attr_types: dict[str, str], field: str | None, op: str | None, value) -> dict | None:
    if field in (None, "") and op in (None, "") and value in (None, ""):
        return None
    if field in (None, "") or op in (None, ""):
        raise GenericQueryError("属性过滤必须同时给出字段和运算符")
    kind = _attr_kind(attr_types, field)
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
    """明细只返回模型定义上的四列。name/value 留给分布图，不作为表格列。"""
    return {
        "classification_name": row.get("classification_name") or "",
        "model_name": row.get("model_name") or "",
        "model_id": row.get("model_id") or "",
        "instance_count": int(row.get("instance_count") or 0),
    }


def _model_distribution_items(rows: list[dict]) -> list[dict]:
    items = [
        {
            "name": str(row.get("model_name") or row.get("model_id") or ""),
            "model_id": str(row.get("model_id") or ""),
            "value": int(row.get("instance_count") or 0),
        }
        for row in rows
    ]
    _unique_distribution_names(items)
    return items


def _unique_distribution_names(items: list[dict]) -> None:
    """重名模型的图表类目附上模型标识，避免柱、饼和图例按 name 覆盖。"""
    bases = [str(item.get("name") or item.get("model_id") or "") for item in items]
    counts: dict[str, int] = {}
    for base in bases:
        counts[base] = counts.get(base, 0) + 1
    used: set[str] = set()
    for item, base in zip(items, bases):
        model_id = str(item.get("model_id") or "")
        candidate = base if counts[base] == 1 else f"{base} ({model_id})"
        if candidate in used:
            stem = f"{base} ({model_id})"
            candidate = stem
            serial = 2
            while candidate in used:
                candidate = f"{stem}-{serial}"
                serial += 1
        used.add(candidate)
        item["name"] = candidate


def _apply_result_filter(rows: list[dict], op: str | None, value, result_filter=None) -> list[dict]:
    try:
        logic, items = parse_condition_group(result_filter)
    except ConditionGroupError as exc:
        raise GenericQueryError(exc.message) from exc
    comparisons = []
    for item in items:
        if item.get("field") not in (None, "", "instance_count"):
            raise GenericQueryError("实例数筛选只支持实例数")
        comparisons.append(_result_comparison(item.get("op"), item.get("value")))
    legacy = None
    if op not in (None, "") or value not in (None, ""):
        if op not in _RESULT_OPS or value in (None, ""):
            raise GenericQueryError("统计结果筛选必须同时给出受支持的运算符和数值")
        legacy = _result_comparison(op, value)

    def keep(row: dict) -> bool:
        count = row["instance_count"]
        grouped = True
        if comparisons:
            checks = [compare(count, expected) for compare, expected in comparisons]
            grouped = all(checks) if logic == "AND" else any(checks)
        if legacy:
            compare, expected = legacy
            grouped = grouped and compare(count, expected)
        return grouped

    if not comparisons and legacy is None:
        return rows
    return [row for row in rows if keep(row)]


def _result_comparison(op, value):
    if op not in _RESULT_OPS:
        raise GenericQueryError("实例数筛选运算符不受支持")
    return _RESULT_OPS[op], _as_number(value)


def _validate_sort_field(field: str) -> None:
    try:
        CQLValidator.validate_field(field)
    except BaseAppException as exc:
        raise GenericQueryError(f"不支持的排序字段: {field}") from exc


def _group_field(attr_types: dict[str, str], group_by: str | None) -> str:
    if not group_by:
        raise GenericQueryError("属性分布必须指定分组字段")
    _attr_kind(attr_types, group_by)
    CQLValidator.validate_field(group_by)
    return group_by


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


def _parse_order(order: str | None, allowed: set[str], *, default: str) -> tuple[str, bool]:
    text = str(order or "").strip()
    if not text:
        return default, False if default != "value" else True
    descending = text.startswith("-")
    field = text[1:] if descending else text
    if field not in allowed:
        raise GenericQueryError(f"不支持的排序字段: {field}")
    return field, descending


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


def _value_payload(value, *, unit: str, aggregation: str) -> dict:
    return {
        "structure": "value",
        "status": "ok",
        "value": value,
        "unit": unit,
        "aggregation": aggregation,
    }


def _category_payload(items: list[dict], *, unit: str, aggregation: str) -> dict:
    return {
        "structure": "category",
        "status": "ok",
        "items": items,
        "unit": unit,
        "aggregation": aggregation,
    }


def _public_instance(row: dict) -> dict:
    if not isinstance(row, dict):
        return {}
    return {key: value for key, value in row.items() if not str(key).startswith("_")}


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
