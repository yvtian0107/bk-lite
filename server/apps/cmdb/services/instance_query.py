"""运营分析用的 CMDB 实例查询。

一条查询按 analysis_mode 分支：
- list：明细。先等值过滤，再按实例排序分页。
- count：数量。先等值过滤，再取该模型的过滤后总数，结果始终是一行摘要。
- distribution：属性分布。先等值过滤，再按分组字段计数，然后对分组结果排序分页。
- aggregate 以及 sum/avg/min/max：明确失败，不查图。

权限映射由 NATS 适配层算好后传入。空映射在这里直接拒绝，避免图查询丢掉组织条件后变成全量。
未选模型直接失败，不会改去查别的模型。
"""

from __future__ import annotations

import re
from typing import Any, Callable

_MODEL_ID_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_INT_PATTERN = re.compile(r"-?\d+")
_FILTER_SPLIT = re.compile(r"[;\n]+")
_UNSUPPORTED_FILTER_MARKS = ("!=", "<>", ">=", "<=", "==", ">", "<", "*", "~")

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 200
DEFAULT_ORDER_FIELD = "inst_name"
MAX_KEY_ATTRS = 12

ANALYSIS_LIST = "list"
ANALYSIS_COUNT = "count"
ANALYSIS_DISTRIBUTION = "distribution"
IMPLEMENTED_ANALYSIS_MODES = (ANALYSIS_LIST, ANALYSIS_COUNT, ANALYSIS_DISTRIBUTION)
_UNIMPLEMENTED_ANALYSIS_MODES = frozenset({"aggregate", "sum", "avg", "min", "max"})
_COUNT_ORDERS = frozenset({"count", "-count", "model_id", "-model_id"})
_DISTRIBUTION_ORDERS = frozenset({"count", "-count", "group_value", "-group_value"})
AGGREGATE_UNSUPPORTED_MESSAGE = "数值聚合暂不支持，目前只支持 list（明细）、count（数量）、distribution（属性分布）"
UNKNOWN_ANALYSIS_MODE_MESSAGE = "不支持的分析方式，目前支持 list（明细）、count（数量）、distribution（属性分布）"

_IDENTITY_FIELDS = (
    {"key": "inst_uuid", "title": "实例UUID", "value_type": "string", "attr_type": "str"},
    {"key": "inst_name", "title": "实例名", "value_type": "string", "attr_type": "str"},
    {"key": "model_id", "title": "模型", "value_type": "string", "attr_type": "str"},
)
_COUNT_FIELDS = (
    {"key": "model_id", "title": "模型", "value_type": "string", "attr_type": "str"},
    {"key": "count", "title": "数量", "value_type": "number", "attr_type": "int"},
)
_DISTRIBUTION_FIELDS = (
    {"key": "model_id", "title": "模型", "value_type": "string", "attr_type": "str"},
    {"key": "group_value", "title": "分组值", "value_type": "string", "attr_type": "str"},
    {"key": "count", "title": "数量", "value_type": "number", "attr_type": "int"},
)
_SKIP_ATTR_IDS = frozenset({"organization", "node_id", "monitor_id"})
_EQUALITY_ATTR_TYPES = frozenset({"str", "enum", "int", "bool"})
_SORTABLE_ATTR_TYPES = _EQUALITY_ATTR_TYPES | frozenset({"float", "time"})
_VALUE_TYPE_BY_ATTR = {
    "int": "number",
    "float": "number",
    "bool": "boolean",
    "time": "datetime",
}


def identity_fields() -> list[dict[str, str]]:
    return [_public_field(item) for item in _IDENTITY_FIELDS]


def count_fields() -> list[dict[str, str]]:
    return [_public_field(item) for item in _COUNT_FIELDS]


def distribution_fields(group_attr: dict[str, Any] | None = None) -> list[dict[str, str]]:
    fields = [_public_field(item) for item in _DISTRIBUTION_FIELDS]
    if group_attr is not None:
        fields[1] = {
            "key": "group_value",
            "title": str(group_attr.get("attr_name") or "分组值"),
            "value_type": _VALUE_TYPE_BY_ATTR.get(group_attr.get("attr_type") or "", "string"),
        }
    return fields


def empty_payload(fields: list[dict[str, str]] | None = None) -> dict[str, Any]:
    return {"items": [], "count": 0, "fields": list(fields or identity_fields())}


def parse_model_id(raw: Any) -> str:
    if isinstance(raw, (list, tuple, dict)):
        raise ValueError("请选择一个模型")
    text = "" if raw is None else str(raw).strip()
    if not text:
        raise ValueError("请选择模型")
    if not _MODEL_ID_PATTERN.fullmatch(text):
        raise ValueError("模型标识不合法")
    return text


def parse_analysis_mode(raw: Any) -> str:
    if raw in (None, ""):
        raise ValueError("请选择分析方式")
    if not isinstance(raw, str):
        raise ValueError("分析方式不正确")
    mode = raw.strip()
    if not mode:
        raise ValueError("请选择分析方式")
    if mode in _UNIMPLEMENTED_ANALYSIS_MODES:
        raise ValueError(AGGREGATE_UNSUPPORTED_MESSAGE)
    if mode not in IMPLEMENTED_ANALYSIS_MODES:
        raise ValueError(UNKNOWN_ANALYSIS_MODE_MESSAGE)
    return mode


class CmdbInstanceQueryService:
    """按分析方式查询指定模型：明细、数量或属性分布。"""

    def __init__(
        self,
        list_instances: Callable[..., tuple[list, int]],
        group_counts: Callable[..., dict],
    ):
        self.list_instances = list_instances
        self.group_counts = group_counts

    def run(
        self,
        *,
        model_id: str,
        attrs: list[dict[str, Any]] | None,
        analysis_mode: Any = None,
        attr_filters: Any = "",
        group_by: Any = "",
        agg_field: Any = "",
        agg_func: Any = "",
        order: Any = "",
        page: Any = None,
        page_size: Any = None,
        permission_map: dict | None,
        creator: str = "",
    ) -> dict[str, Any]:
        model_id = parse_model_id(model_id)
        if not permission_map:
            raise ValueError("无权查询实例")
        mode = parse_analysis_mode(analysis_mode)
        self._reject_unused_inputs(mode, group_by, agg_field, agg_func)

        catalog = _attr_catalog(attrs)
        filters = compile_equality_filters(attr_filters, catalog)
        page_number = _parse_positive(page, "page", DEFAULT_PAGE, maximum=None)
        size = _parse_positive(page_size, "page_size", DEFAULT_PAGE_SIZE, maximum=MAX_PAGE_SIZE)
        if mode == ANALYSIS_LIST:
            return self._list(model_id, catalog, filters, order, page_number, size, permission_map, creator)
        if mode == ANALYSIS_COUNT:
            return self._count(model_id, filters, order, page_number, size, permission_map, creator)
        return self._distribution(model_id, catalog, filters, group_by, order, page_number, size, permission_map, creator)

    def _reject_unused_inputs(self, mode: str, group_by: Any, agg_field: Any, agg_func: Any) -> None:
        if mode != ANALYSIS_DISTRIBUTION and _present(group_by):
            raise ValueError("当前分析方式不使用分组字段")
        if _present(agg_field) or _present(agg_func):
            raise ValueError("当前分析方式不使用聚合字段，数值聚合暂不支持")

    def _list(self, model_id, catalog, filters, order, page_number, size, permission_map, creator):
        fields = select_display_fields(catalog)
        order_field = compile_order(order, catalog)
        instances, count = self.list_instances(
            model_id=model_id,
            params=filters,
            page=page_number,
            page_size=size,
            order=order_field,
            permission_map=permission_map,
            creator=creator or "",
        )
        rows = [_project_row(item, fields) for item in (instances or []) if isinstance(item, dict)]
        return {"items": rows, "count": _normalize_count(count, len(rows)), "fields": fields}

    def _count(self, model_id, filters, order, page_number, size, permission_map, creator):
        summary_order = _compile_summary_order(order, _COUNT_ORDERS, "数量结果")
        _instances, total = self.list_instances(
            model_id=model_id,
            params=filters,
            page=DEFAULT_PAGE,
            page_size=1,
            order=DEFAULT_ORDER_FIELD,
            permission_map=permission_map,
            creator=creator or "",
        )
        row = {"model_id": model_id, "count": _require_total(total)}
        rows = _sort_summary_rows([row], summary_order)
        return _page_rows(rows, page_number, size, count_fields())

    def _distribution(self, model_id, catalog, filters, group_by, order, page_number, size, permission_map, creator):
        group_attr = _parse_group_by(group_by, catalog)
        summary_order = _compile_summary_order(order, _DISTRIBUTION_ORDERS, "属性分布结果") or "-count"
        buckets = self.group_counts(
            group_by_attr=group_attr["attr_id"],
            permissions_map=permission_map,
            params=[{"field": "model_id", "type": "str=", "value": model_id}, *filters],
            creator=creator or "",
        )
        if not isinstance(buckets, dict):
            raise ValueError("属性分布结果不正确")
        rows = []
        for key, value in buckets.items():
            rows.append(
                {
                    "model_id": model_id,
                    "group_value": "" if key is None else key,
                    "count": _require_total(value),
                }
            )
        rows = _sort_summary_rows(rows, summary_order)
        return _page_rows(rows, page_number, size, distribution_fields(group_attr))


def select_display_fields(catalog: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    """身份列固定在前。关键展示列优先唯一、必填、预置属性，其余按模型定义顺序补齐。"""
    fields = identity_fields()
    seen = {item["key"] for item in fields}
    candidates = []
    for index, attr in enumerate(catalog.values()):
        attr_id = attr["attr_id"]
        if attr_id in seen or not _is_key_display_attr(attr):
            continue
        candidates.append((index, attr))
    candidates.sort(key=lambda item: (_display_rank(item[1]), item[0]))
    for _, attr in candidates[:MAX_KEY_ATTRS]:
        fields.append(_public_field(attr))
    return fields


def compile_equality_filters(raw: Any, catalog: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    pairs = _parse_filter_text(raw)
    compiled = []
    seen = set()
    for field, value in pairs:
        if field == "model_id":
            raise ValueError("模型已由模型参数限定，属性过滤不能改查其他模型")
        if field in seen:
            raise ValueError(f"属性过滤字段 {field} 重复")
        seen.add(field)
        attr = catalog.get(field)
        if attr is None:
            raise ValueError(f"字段 {field} 不存在，无法过滤")
        compiled.append(_compile_one_filter(attr, value))
    return compiled


def compile_order(raw: Any, catalog: dict[str, dict[str, Any]]) -> str:
    if raw in (None, ""):
        return DEFAULT_ORDER_FIELD
    if not isinstance(raw, str):
        raise ValueError("排序必须是字段名，降序加 - 前缀")
    text = raw.strip()
    if not text:
        return DEFAULT_ORDER_FIELD
    if any(mark in text for mark in (",", " ")):
        raise ValueError("暂不支持多字段排序")
    descending = text.startswith("-")
    field = text[1:] if descending else text
    attr = catalog.get(field)
    if attr is None or not _is_sortable(attr):
        raise ValueError(f"不支持按 {field or text} 排序")
    return f"-{field}" if descending else field


def _identity_attr(item: dict[str, str]) -> dict[str, Any]:
    return {
        "attr_id": item["key"],
        "attr_name": item["title"],
        "attr_type": item["attr_type"],
        "title": item["title"],
        "value_type": item["value_type"],
    }


def _attr_catalog(attrs: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    catalog = {item["key"]: _identity_attr(item) for item in _IDENTITY_FIELDS}
    identity_ids = set(catalog)
    for attr in attrs or []:
        if not isinstance(attr, dict):
            continue
        attr_id = str(attr.get("attr_id") or "").strip()
        if not attr_id or attr_id in identity_ids or not _MODEL_ID_PATTERN.fullmatch(attr_id):
            continue
        catalog[attr_id] = {
            "attr_id": attr_id,
            "attr_name": str(attr.get("attr_name") or attr_id),
            "attr_type": str(attr.get("attr_type") or ""),
            "is_only": bool(attr.get("is_only")),
            "is_required": bool(attr.get("is_required")),
            "is_pre": bool(attr.get("is_pre")),
            "is_display_field": bool(attr.get("is_display_field")),
            "is_system_link": bool(attr.get("is_system_link")),
            "enum_select_mode": str(attr.get("enum_select_mode") or ""),
        }
    return catalog


def _parse_filter_text(raw: Any) -> list[tuple[str, str]]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, str):
        raise ValueError("属性过滤必须是字符串，形如 ip_addr=10.0.0.1，多个条件用分号分隔")
    text = raw.strip()
    if not text:
        return []
    pairs = []
    for part in _FILTER_SPLIT.split(text):
        item = part.strip()
        if not item:
            continue
        if any(mark in item for mark in _UNSUPPORTED_FILTER_MARKS):
            raise ValueError("属性过滤仅支持等值，形如 ip_addr=10.0.0.1，不支持比较或模糊匹配")
        if "=" not in item:
            raise ValueError("属性过滤仅支持等值，形如 ip_addr=10.0.0.1")
        field, value = item.split("=", 1)
        field = field.strip()
        if not field or value.strip() == "":
            raise ValueError("属性过滤需要字段和值，形如 ip_addr=10.0.0.1")
        pairs.append((field, value.strip()))
    return pairs


def _compile_one_filter(attr: dict[str, Any], value: str) -> dict[str, Any]:
    field = attr["attr_id"]
    title = attr.get("attr_name") or field
    attr_type = attr.get("attr_type") or ""
    if attr_type == "enum" and attr.get("enum_select_mode") == "multiple":
        raise ValueError(f"暂不支持按多选枚举 {title} 等值过滤")
    if attr_type not in _EQUALITY_ATTR_TYPES:
        kind = attr_type or "未知类型"
        raise ValueError(f"暂不支持按字段 {title}（{kind}）过滤，目前只支持字符串、枚举、整数和布尔等值")
    if attr_type == "int":
        parsed: Any = _parse_int(value, title)
        query_type = "int="
    elif attr_type == "bool":
        parsed = _parse_bool(value, title)
        query_type = "bool"
    else:
        parsed = value
        query_type = "str="
    return {"field": field, "type": query_type, "value": parsed}


def _parse_group_by(raw: Any, catalog: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("属性分布需要填写分组字段")
    field = raw.strip()
    attr = catalog.get(field)
    if attr is None:
        raise ValueError(f"字段 {field} 不存在，无法分组")
    if not _is_sortable(attr):
        raise ValueError(f"不支持按 {attr.get('attr_name') or field} 分组")
    return attr


def _compile_summary_order(raw: Any, allowed: frozenset[str], label: str) -> str:
    if raw in (None, ""):
        return ""
    if not isinstance(raw, str):
        raise ValueError(f"{label}的排序必须是字段名，降序加 - 前缀")
    text = raw.strip()
    if not text:
        return ""
    if text not in allowed:
        raise ValueError(f"{label}不支持按 {text} 排序")
    return text


def _present(raw: Any) -> bool:
    if raw is None:
        return False
    if isinstance(raw, str):
        return bool(raw.strip())
    return True


def _parse_positive(value: Any, name: str, default: int, maximum: int | None) -> int:
    if value in (None, ""):
        number = default
    else:
        try:
            number = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} 必须是正整数") from exc
        if isinstance(value, float) and number != value:
            raise ValueError(f"{name} 必须是正整数")
        if isinstance(value, str) and not _INT_PATTERN.fullmatch(value.strip()):
            raise ValueError(f"{name} 必须是正整数")
    if number <= 0:
        raise ValueError(f"{name} 必须是正整数")
    if maximum is not None and number > maximum:
        raise ValueError(f"{name} 不能超过 {maximum}")
    return number


def _parse_int(value: str, title: str) -> int:
    if not _INT_PATTERN.fullmatch(value):
        raise ValueError(f"字段 {title} 需要整数")
    return int(value)


def _parse_bool(value: str, title: str) -> bool:
    token = value.strip().lower()
    if token in {"true", "1", "yes"}:
        return True
    if token in {"false", "0", "no"}:
        return False
    raise ValueError(f"字段 {title} 需要布尔值 true 或 false")


def _is_key_display_attr(attr: dict[str, Any]) -> bool:
    if attr.get("is_display_field") or attr.get("is_system_link"):
        return False
    attr_id = attr.get("attr_id") or ""
    if attr_id in _SKIP_ATTR_IDS or attr_id.startswith("_"):
        return False
    return attr.get("attr_type") in _SORTABLE_ATTR_TYPES


def _is_sortable(attr: dict[str, Any]) -> bool:
    if attr["attr_id"] in {item["key"] for item in _IDENTITY_FIELDS}:
        return True
    return _is_key_display_attr(attr)


def _display_rank(attr: dict[str, Any]) -> int:
    if attr.get("is_only"):
        return 0
    if attr.get("is_required"):
        return 1
    if attr.get("is_pre"):
        return 2
    return 3


def _public_field(attr: dict[str, Any]) -> dict[str, str]:
    key = attr.get("key") or attr["attr_id"]
    title = attr.get("title") or attr.get("attr_name") or key
    attr_type = attr.get("attr_type") or "str"
    return {
        "key": key,
        "title": title,
        "value_type": attr.get("value_type") or _VALUE_TYPE_BY_ATTR.get(attr_type, "string"),
    }


def _project_row(entity: dict[str, Any], fields: list[dict[str, str]]) -> dict[str, Any]:
    row = {}
    for field in fields:
        key = field["key"]
        value = entity.get(key)
        row[key] = "" if value is None else value
    return row


def _normalize_count(count: Any, row_count: int) -> int:
    try:
        number = int(count)
    except (TypeError, ValueError):
        return row_count
    if number < 0:
        return row_count
    return number


def _require_total(count: Any) -> int:
    try:
        number = int(count)
    except (TypeError, ValueError) as exc:
        raise ValueError("数量结果不正确") from exc
    if isinstance(count, float) and number != count:
        raise ValueError("数量结果不正确")
    if number < 0:
        raise ValueError("数量结果不正确")
    return number


def _sort_summary_rows(rows: list[dict[str, Any]], order: str) -> list[dict[str, Any]]:
    if not order:
        return rows
    descending = order.startswith("-")
    field = order[1:] if descending else order

    def sort_key(row: dict[str, Any]):
        value = row.get(field)
        if field == "count":
            return (value, str(row.get("group_value", row.get("model_id", ""))))
        return (str(value), row.get("count", 0))

    return sorted(rows, key=sort_key, reverse=descending)


def _page_rows(rows: list[dict[str, Any]], page: int, size: int, fields: list[dict[str, str]]) -> dict[str, Any]:
    start = (page - 1) * size
    return {"items": rows[start : start + size], "count": len(rows), "fields": fields}
