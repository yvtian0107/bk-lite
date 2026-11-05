"""运营分析用的 CMDB 实例明细查询。

只做一种分析：明细列表。顺序是先按模型和等值条件收窄，再排序、分页。
权限映射由 NATS 适配层算好后传入。空映射在这里直接拒绝，避免图查询丢掉组织条件后变成全量。
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

_IDENTITY_FIELDS = (
    {"key": "inst_uuid", "title": "实例UUID", "value_type": "string", "attr_type": "str"},
    {"key": "inst_name", "title": "实例名", "value_type": "string", "attr_type": "str"},
    {"key": "model_id", "title": "模型", "value_type": "string", "attr_type": "str"},
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


class CmdbInstanceListService:
    """把模型、等值过滤、排序和分页收成一次实例列表查询。"""

    def __init__(self, list_instances: Callable[..., tuple[list, int]]):
        self.list_instances = list_instances

    def run(
        self,
        *,
        model_id: str,
        attrs: list[dict[str, Any]] | None,
        attr_filters: Any = "",
        order: Any = "",
        page: Any = None,
        page_size: Any = None,
        permission_map: dict | None,
        creator: str = "",
    ) -> dict[str, Any]:
        model_id = parse_model_id(model_id)
        if not permission_map:
            raise ValueError("无权查询实例")

        catalog = _attr_catalog(attrs)
        fields = select_display_fields(catalog)
        filters = compile_equality_filters(attr_filters, catalog)
        order_field = compile_order(order, catalog)
        page_number = _parse_positive(page, "page", DEFAULT_PAGE, maximum=None)
        size = _parse_positive(page_size, "page_size", DEFAULT_PAGE_SIZE, maximum=MAX_PAGE_SIZE)

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
