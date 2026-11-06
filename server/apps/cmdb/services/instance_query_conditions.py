"""把实例查询的条件树编译成图查询能执行的 AND 子句。

一棵树里，叶子带适用范围：global 或某个模型。编译某个模型时，其它模型的叶子不参与
（不是真，也不是假）；全局叶子若该模型没有这个属性，则该模型整支不匹配。不会把无法
识别的叶子丢掉，否则过滤范围会被放大。
"""

from __future__ import annotations

import re
from typing import Any

_MODEL_ID_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_INT_PATTERN = re.compile(r"-?\d+")
_NUMBER_PATTERN = re.compile(r"-?(?:\d+)(?:\.\d+)?$")

MAX_DEPTH = 4
MAX_LEAVES = 10
MAX_CLAUSES = 16

_ABSENT = object()
_UNSAT = object()

OPERATORS_BY_TYPE = {
    "str": ("str=", "str<>", "str*", "str!*", "empty", "not_empty"),
    "int": ("int=", "int<>", "int>", "int<", "empty", "not_empty"),
    "float": ("int=", "int<>", "int>", "int<", "empty", "not_empty"),
    "enum": ("list_any[]", "list_none[]", "empty", "not_empty"),
    "time": ("time", "time<", "time>", "empty", "not_empty"),
    "bool": ("bool", "empty", "not_empty"),
}

OPERATOR_LABELS = {
    "str=": ("等于", "text"),
    "str<>": ("不等于", "text"),
    "str*": ("包含", "text"),
    "str!*": ("不包含", "text"),
    "int=": ("等于", "number"),
    "int<>": ("不等于", "number"),
    "int>": ("大于", "number"),
    "int<": ("小于", "number"),
    "list_any[]": ("包含任一", "enum"),
    "list_none[]": ("不包含", "enum"),
    "time": ("在范围内", "range"),
    "time<": ("早于", "time"),
    "time>": ("晚于", "time"),
    "bool": ("等于", "bool"),
    "empty": ("为空", "none"),
    "not_empty": ("不为空", "none"),
}

VALUELESS = frozenset({"empty", "not_empty"})
AGGREGATE_FUNCS = frozenset({"count", "sum", "avg", "min", "max"})
NUMERIC_FUNCS = frozenset({"sum", "avg", "min", "max"})
FILTERABLE_TYPES = frozenset(OPERATORS_BY_TYPE)


def operator_choices(attr_type: str) -> list[dict[str, str]]:
    choices = []
    for operator in OPERATORS_BY_TYPE.get(attr_type, ()):
        label, kind = OPERATOR_LABELS[operator]
        choices.append({"value": operator, "label": label, "value_kind": kind})
    return choices


def model_clauses_or_unsat(tree: Any, model_id: str, catalog: dict[str, dict[str, Any]], scope_model_ids: set[str]):
    """返回 OR 起来的 AND 子句。空列表表示没有约束，None 表示该模型不可能匹配。"""
    state = {"leaves": 0}
    compiled = _compile_node(tree, model_id, catalog, scope_model_ids, 1, state)
    if compiled is _ABSENT:
        return []
    if compiled is _UNSAT:
        return None
    return compiled


def _compile_node(node, model_id, catalog, scope_model_ids, depth, state):
    if node in (None, "", {}):
        return _ABSENT
    if not isinstance(node, dict):
        raise ValueError("条件必须是结构化条件树")
    if depth > MAX_DEPTH:
        raise ValueError("条件层级过深")
    if "children" in node or (node.get("logic") and "attr_id" not in node):
        return _compile_group(node, model_id, catalog, scope_model_ids, depth, state)
    return _compile_leaf(node, model_id, catalog, scope_model_ids, state)


def _compile_group(node, model_id, catalog, scope_model_ids, depth, state):
    logic = str(node.get("logic") or "and").strip().lower()
    if logic not in {"and", "or"}:
        raise ValueError("条件组只支持 and 或 or")
    children = node.get("children")
    if children in (None, []):
        return _ABSENT
    if not isinstance(children, list):
        raise ValueError("条件组的 children 必须是列表")
    compiled = [_compile_node(child, model_id, catalog, scope_model_ids, depth + 1, state) for child in children]
    if logic == "and":
        return _combine_and(compiled)
    return _combine_or(compiled)


def _combine_and(parts):
    clauses = [[]]
    saw_clause = False
    for part in parts:
        if part is _UNSAT:
            return _UNSAT
        if part is _ABSENT:
            continue
        saw_clause = True
        clauses = [_concat(left, right) for left in clauses for right in part]
        if len(clauses) > MAX_CLAUSES:
            raise ValueError("条件组合过于复杂")
    if not saw_clause:
        return _ABSENT
    return clauses


def _combine_or(parts):
    clauses = []
    saw_unsat = False
    for part in parts:
        if part is _ABSENT:
            continue
        if part is _UNSAT:
            saw_unsat = True
            continue
        clauses.extend(part)
        if len(clauses) > MAX_CLAUSES:
            raise ValueError("条件组合过于复杂")
    if clauses:
        return clauses
    if saw_unsat:
        return _UNSAT
    return _ABSENT


def _concat(left, right):
    merged = list(left)
    seen = {item["field"] for item in merged}
    for item in right:
        if item["field"] in seen:
            raise ValueError(f"同一模型的条件字段 {item['field']} 在一个 AND 分支里重复")
        seen.add(item["field"])
        merged.append(item)
    return merged


def explicit_field_refs(node):
    """叶子上写明的「模型:属性」。没有则返回空，调用方不能按属性名自行补齐。"""
    raw_sources = node.get("sources") if isinstance(node, dict) else None
    raw_items = raw_sources if isinstance(raw_sources, list) and raw_sources else None
    if raw_items is None:
        field_ref = node.get("field_ref") if isinstance(node, dict) else None
        raw_items = [field_ref] if isinstance(field_ref, str) and field_ref.strip() else []
    refs = []
    for item in raw_items:
        model_id, attr_id = _split_field_ref(item)
        refs.append((model_id, attr_id))
    return refs


def _split_field_ref(item):
    if isinstance(item, str) and ":" in item:
        model_id, attr_id = item.split(":", 1)
    elif isinstance(item, dict):
        model_id = str(item.get("model_id") or "")
        attr_id = str(item.get("attr_id") or "")
    else:
        raise ValueError("条件字段需要带上所属模型")
    model_id = model_id.strip()
    attr_id = attr_id.strip()
    if not _MODEL_ID_PATTERN.fullmatch(model_id) or not _MODEL_ID_PATTERN.fullmatch(attr_id):
        raise ValueError("条件字段标识不正确")
    if attr_id == "model_id":
        raise ValueError("模型已由模型参数限定，条件不能改查其他模型")
    return model_id, attr_id


def _compile_leaf(node, model_id, catalog, scope_model_ids, state):
    state["leaves"] += 1
    if state["leaves"] > MAX_LEAVES:
        raise ValueError(f"条件不能超过 {MAX_LEAVES} 条")
    scope = node.get("scope") or "global"
    if not isinstance(scope, str) or not scope.strip():
        raise ValueError("条件适用范围不正确")
    scope = scope.strip()
    refs = explicit_field_refs(node)
    if scope == "global":
        if not refs:
            raise ValueError("全局条件必须指明模型字段，同名属性不会自动当作同一字段")
        matched = [attr_id for owner, attr_id in refs if owner == model_id]
        if not matched:
            if any(owner not in scope_model_ids for owner, _attr_id in refs):
                raise ValueError("条件引用的模型不在查询范围内")
            return _UNSAT
        if len(matched) > 1:
            raise ValueError("同一模型在一个全局条件里重复")
        attr = catalog.get(matched[0])
        if attr is None:
            raise ValueError(f"字段 {matched[0]} 不存在，无法作为条件")
        return [[compile_filter(attr, node.get("operator"), node.get("value"))]]
    attr_id = refs[0][1] if refs else str(node.get("attr_id") or "").strip()
    if refs and (len(refs) != 1 or refs[0][0] != scope):
        raise ValueError("模型条件只能使用该模型自己的字段")
    if not attr_id or not _MODEL_ID_PATTERN.fullmatch(attr_id):
        raise ValueError("条件字段不正确")
    if attr_id == "model_id":
        raise ValueError("模型已由模型参数限定，条件不能改查其他模型")
    if scope != model_id:
        if scope not in scope_model_ids:
            raise ValueError("条件引用的模型不在查询范围内")
        return _ABSENT
    attr = catalog.get(attr_id)
    if attr is None:
        raise ValueError(f"字段 {attr_id} 不存在，无法作为条件")
    return [[compile_filter(attr, node.get("operator"), node.get("value"))]]


def compile_filter(attr: dict[str, Any], operator: Any, value: Any) -> dict[str, Any]:
    attr_type = str(attr.get("attr_type") or "")
    allowed = OPERATORS_BY_TYPE.get(attr_type)
    title = str(attr.get("attr_name") or attr.get("attr_id") or "字段")
    if not allowed:
        raise ValueError(f"不支持按字段 {title}（{attr_type or '未知类型'}）过滤")
    if not isinstance(operator, str) or operator not in allowed:
        raise ValueError(f"字段 {title} 不支持运算符 {operator or ''}")
    field = attr["attr_id"]
    if operator in VALUELESS:
        if value not in (None, "", [], {}):
            raise ValueError(f"字段 {title} 的运算符 {operator} 不需要取值")
        return {"field": field, "type": operator}
    if operator == "time":
        start, end = _time_range(value, title)
        return {"field": field, "type": "time", "start": start, "end": end}
    if operator in {"list_any[]", "list_none[]"}:
        return {"field": field, "type": operator, "value": _enum_values(attr, value, title)}
    if operator == "bool":
        return {"field": field, "type": "bool", "value": _parse_bool(value, title)}
    if operator.startswith("int"):
        return {"field": field, "type": operator, "value": _parse_number(value, title, attr_type)}
    if operator in {"time<", "time>"}:
        return {"field": field, "type": operator, "value": _time_point(value, title)}
    if not isinstance(value, str) or value == "":
        raise ValueError(f"字段 {title} 需要文本值")
    return {"field": field, "type": operator, "value": value}


def _enum_values(attr, value, title):
    options = attr.get("enum_options")
    if not isinstance(options, list) or not options:
        raise ValueError(f"字段 {title} 的枚举选项不可用，不能按该字段过滤")
    allowed = {}
    for item in options:
        if not isinstance(item, dict):
            continue
        option_id = item.get("id", item.get("value"))
        if option_id in (None, ""):
            continue
        allowed[str(option_id)] = item.get("name", item.get("label", option_id))
    if isinstance(value, (list, tuple)):
        raw_values = value
    elif value in (None, ""):
        raw_values = []
    else:
        raw_values = [value]
    if not raw_values:
        raise ValueError(f"字段 {title} 需要选择枚举值")
    chosen = []
    for item in raw_values:
        token = str(item)
        if token not in allowed:
            raise ValueError(f"字段 {title} 的枚举值 {token} 不在可选范围内")
        chosen.append(token)
    return chosen


def _parse_bool(value, title):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().lower()
        if token in {"true", "1", "yes"}:
            return True
        if token in {"false", "0", "no"}:
            return False
    raise ValueError(f"字段 {title} 需要布尔值")


def _parse_number(value, title, attr_type):
    if isinstance(value, bool):
        raise ValueError(f"字段 {title} 需要数字")
    if attr_type == "int":
        if isinstance(value, int):
            return value
        if isinstance(value, str) and _INT_PATTERN.fullmatch(value.strip()):
            return int(value.strip())
        raise ValueError(f"字段 {title} 需要整数")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str) and _NUMBER_PATTERN.fullmatch(value.strip()):
        return float(value.strip()) if "." in value else int(value.strip())
    raise ValueError(f"字段 {title} 需要数字")


def _time_point(value, title):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"字段 {title} 需要时间")
    return value.strip()


def _time_range(value, title):
    if not isinstance(value, dict):
        raise ValueError(f"字段 {title} 需要开始和结束时间")
    start = value.get("start")
    end = value.get("end")
    if not isinstance(start, str) or not start.strip() or not isinstance(end, str) or not end.strip():
        raise ValueError(f"字段 {title} 需要开始和结束时间")
    return start.strip(), end.strip()
