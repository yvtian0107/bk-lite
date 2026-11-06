"""运营分析用的 CMDB 实例查询。

一条查询覆盖四种分析：明细、数量、属性分布、数值聚合。范围由分类和模型共同决定，
两者都可以空。条件是结构化树，先过滤再统计，统计结果再排序分页。超过扫描上限时
直接失败，不用前 N 条冒充全量。
"""

from __future__ import annotations

import re
from typing import Any, Callable

from apps.cmdb.services.instance_query_conditions import AGGREGATE_FUNCS, FILTERABLE_TYPES, NUMERIC_FUNCS, model_clauses_or_unsat, operator_choices

_MODEL_ID_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_INT_PATTERN = re.compile(r"-?\d+")
_FILTER_SPLIT = re.compile(r"[;\n]+")
_LEGACY_MARKS = ("!=", "<>", ">=", "<=", "==", ">", "<", "*", "~")

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 200
MAX_SCAN = 5000
MAX_BUCKETS = 2000
MAX_KEY_ATTRS = 12
DEFAULT_ORDER_FIELD = "inst_name"

ANALYSIS_LIST = "list"
ANALYSIS_COUNT = "count"
ANALYSIS_DISTRIBUTION = "distribution"
ANALYSIS_AGGREGATE = "aggregate"
ANALYSIS_MODES = (ANALYSIS_LIST, ANALYSIS_COUNT, ANALYSIS_DISTRIBUTION, ANALYSIS_AGGREGATE)

NOT_APPLICABLE = "不适用"
UNFILLED = "未填写"
KIND_VALUE = "value"
KIND_EMPTY = "empty"
KIND_UNFILLED = "unfilled"
KIND_NA = "not_applicable"

_SKIP_ATTR_IDS = frozenset({"organization", "node_id", "monitor_id"})
_SORTABLE_TYPES = FILTERABLE_TYPES
_VALUE_TYPE_BY_ATTR = {"int": "number", "float": "number", "bool": "boolean", "time": "datetime"}
_IDENTITY = (
    {"key": "inst_uuid", "title": "实例UUID", "value_type": "string", "attr_type": "str", "role": "identity"},
    {"key": "inst_name", "title": "实例名", "value_type": "string", "attr_type": "str", "role": "identity"},
    {"key": "model_id", "title": "模型", "value_type": "string", "attr_type": "str", "role": "dimension"},
)


def identity_fields() -> list[dict[str, str]]:
    return [_public_field(item) for item in _IDENTITY]


def empty_payload(fields: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"items": [], "count": 0, "fields": list(fields or identity_fields())}


def parse_analysis_mode(raw: Any) -> str:
    if raw in (None, ""):
        raise ValueError("请选择分析方式")
    if not isinstance(raw, str):
        raise ValueError("分析方式不正确")
    mode = raw.strip()
    if mode not in ANALYSIS_MODES:
        raise ValueError("不支持的分析方式，目前支持 list（明细）、count（数量）、distribution（属性分布）、aggregate（数值聚合）")
    return mode


def parse_id_list(raw: Any, label: str) -> list[str]:
    if raw in (None, "", []):
        return []
    if isinstance(raw, str):
        raw = [part.strip() for part in raw.split(",") if part.strip()]
    if not isinstance(raw, (list, tuple)):
        raise ValueError(f"{label}格式不正确")
    values = []
    seen = set()
    for item in raw:
        if isinstance(item, (list, tuple, dict)) or item is None:
            raise ValueError(f"{label}格式不正确")
        text = str(item).strip()
        if not text or text in seen:
            continue
        if not _MODEL_ID_PATTERN.fullmatch(text):
            raise ValueError(f"{label} {text} 不合法")
        seen.add(text)
        values.append(text)
    return values


def resolve_scope(classification_ids: list[str], model_ids: list[str], models: list[dict[str, Any]], classifications: list[dict[str, Any]] | None):
    catalog = []
    for model in models or []:
        model_id = str(model.get("model_id") or "").strip()
        if not model_id:
            continue
        catalog.append(
            {
                "model_id": model_id,
                "model_name": str(model.get("model_name") or model_id),
                "classification_id": str(model.get("classification_id") or ""),
                "classification_name": str(model.get("classification_name") or ""),
            }
        )
    by_id = {item["model_id"]: item for item in catalog}
    known_classifications = {item["classification_id"] for item in catalog if item["classification_id"]}
    names = {}
    for item in classifications or []:
        classification_id = str(item.get("classification_id") or "").strip()
        if not classification_id:
            continue
        known_classifications.add(classification_id)
        names[classification_id] = str(item.get("classification_name") or classification_id)
    for classification_id in classification_ids:
        if classification_id not in known_classifications:
            raise ValueError("分类不存在或当前权限不可见")
    for model in catalog:
        if model["classification_id"] in names:
            model["classification_name"] = names[model["classification_id"]]

    if classification_ids:
        pool = [item for item in catalog if item["classification_id"] in set(classification_ids)]
    else:
        pool = list(catalog)
    pool_ids = {item["model_id"] for item in pool}
    if not model_ids:
        if not pool:
            if classification_ids:
                raise ValueError("所选分类下没有可查询的模型")
            raise ValueError("当前权限下没有可查询的模型")
        return pool
    selected = []
    for model_id in model_ids:
        model = by_id.get(model_id)
        if model is None:
            raise ValueError("模型不存在或当前权限不可见")
        if model_id not in pool_ids:
            raise ValueError("模型不属于所选分类")
        selected.append(model)
    return selected


def describe_query_fields(models: list[dict[str, Any]], attrs_by_model: dict[str, list], analysis_mode: str) -> list[dict[str, Any]]:
    rows = []
    mode = analysis_mode if analysis_mode in ANALYSIS_MODES else ANALYSIS_LIST
    for model in models:
        catalog = _attr_catalog(attrs_by_model.get(model["model_id"]))
        for attr in _display_candidates(catalog):
            attr_type = attr["attr_type"]
            if attr_type not in FILTERABLE_TYPES and attr["attr_id"] not in {item["key"] for item in _IDENTITY}:
                continue
            key = _field_key(model["model_id"], attr["attr_id"])
            rows.append(
                {
                    "key": key,
                    "label": _field_label(model["model_name"], attr["attr_name"]),
                    "kind": "attribute",
                    "model_id": model["model_id"],
                    "model_name": model["model_name"],
                    "attr_id": attr["attr_id"],
                    "attr_type": attr_type,
                    "value_type": _VALUE_TYPE_BY_ATTR.get(attr_type, "string"),
                    "unit": str(attr.get("unit") or ""),
                    "operators": operator_choices(attr_type),
                    "options": _public_enum_options(attr),
                    "funcs": _funcs_for(attr_type),
                    "orderable": True,
                    "order_modes": [ANALYSIS_LIST],
                }
            )
    rows.extend(_summary_order_rows(mode))
    return rows


class CmdbInstanceQueryService:
    def __init__(self, list_instances: Callable[..., tuple[list, int]], group_counts: Callable[..., dict]):
        self.list_instances = list_instances
        self.group_counts = group_counts

    def run(
        self,
        *,
        models: list[dict[str, Any]],
        attrs_by_model: dict[str, list] | None,
        classifications: list[dict[str, Any]] | None = None,
        classification_ids: Any = None,
        model_ids: Any = None,
        model_id: Any = None,
        analysis_mode: Any = None,
        conditions: Any = None,
        attr_filters: Any = None,
        group_by: Any = None,
        metrics: Any = None,
        agg_field: Any = None,
        agg_func: Any = None,
        order: Any = None,
        page: Any = None,
        page_size: Any = None,
        show_not_applicable: Any = None,
        show_unfilled: Any = None,
        permission_for: Callable[[str], dict | None],
        creator: str = "",
    ) -> dict[str, Any]:
        mode = parse_analysis_mode(analysis_mode)
        selected = resolve_scope(
            parse_id_list(classification_ids, "分类"),
            _requested_models(model_id, model_ids),
            models,
            classifications,
        )
        page_number = _parse_positive(page, "page", DEFAULT_PAGE, maximum=None)
        size = _parse_positive(page_size, "page_size", DEFAULT_PAGE_SIZE, maximum=MAX_PAGE_SIZE)
        catalogs = {model["model_id"]: _attr_catalog(None if attrs_by_model is None else attrs_by_model.get(model["model_id"])) for model in selected}
        tree = _normalize_conditions(conditions, attr_filters, selected, catalogs)
        _assert_global_condition_types(tree, selected, catalogs)
        scope_ids = {model["model_id"] for model in selected}
        prepared = []
        for model in selected:
            permission = permission_for(model["model_id"]) if permission_for else None
            if not permission:
                raise ValueError("无权查询实例")
            clauses = model_clauses_or_unsat(tree, model["model_id"], catalogs[model["model_id"]], scope_ids)
            prepared.append((model, catalogs[model["model_id"]], permission, clauses))
        if mode == ANALYSIS_LIST:
            return self._list(prepared, order, page_number, size, creator)
        if mode == ANALYSIS_COUNT:
            return self._count(prepared, order, page_number, size, creator)
        if mode == ANALYSIS_DISTRIBUTION:
            groups = _normalize_groups(group_by, selected, catalogs)
            return self._distribution(
                prepared,
                groups,
                order,
                page_number,
                size,
                creator,
                _parse_flag(show_not_applicable, True),
                _parse_flag(show_unfilled, True),
            )
        metric_specs = _normalize_metrics(metrics, agg_field, agg_func, selected, catalogs)
        return self._aggregate(prepared, metric_specs, order, page_number, size, creator)

    def _list(self, prepared, order, page_number, size, creator):
        fields = _list_fields(prepared)
        allowed = {field["key"] for field in fields}
        order_text = _normalize_order(_alias_single_model_order(order, prepared), allowed, DEFAULT_ORDER_FIELD)
        if len(prepared) == 1 and _single_clause(prepared[0][3]):
            model, catalog, permission, clauses = prepared[0]
            graph_order = _graph_order(order_text, model["model_id"])
            rows, total = self._page_model(model, clauses, permission, creator, page_number, size, graph_order)
            return {"items": [_project_list_row(row, model, fields) for row in rows], "count": total, "fields": fields}
        total = 0
        collected = []
        for model, _catalog, permission, clauses in prepared:
            count = self._count_model(model, clauses, permission, creator)
            total += count
            if total > MAX_SCAN:
                raise ValueError(f"匹配实例超过 {MAX_SCAN}，请缩小条件后再查询。系统不会只扫描前 {MAX_SCAN} 条并当成全量结果")
            fetched, fetched_count = self._page_model(model, clauses, permission, creator, 1, max(count, 1), DEFAULT_ORDER_FIELD)
            if fetched_count != count or len(fetched) < count:
                raise ValueError("实例结果不完整，已中止，不会用部分结果充当全量")
            collected.extend((model, row) for row in fetched)
        collected.sort(key=lambda item: _list_sort_key(item[0], item[1], order_text), reverse=order_text.startswith("-"))
        start = (page_number - 1) * size
        page_rows = [_project_list_row(row, model, fields) for model, row in collected[start : start + size]]
        return {"items": page_rows, "count": len(collected), "fields": fields}

    def _count(self, prepared, order, page_number, size, creator):
        rows = []
        for model, _catalog, permission, clauses in prepared:
            rows.append(
                {
                    "model_id": model["model_id"],
                    "model_name": model["model_name"],
                    "count": self._count_model(model, clauses, permission, creator),
                }
            )
        scope_count = sum(row["count"] for row in rows)
        for row in rows:
            row["scope_count"] = scope_count
        allowed = {"model_id", "model_name", "count", "scope_count"}
        rows = _sort_rows(rows, _normalize_order(order, allowed, "model_id"))
        return _page_rows(rows, page_number, size, _count_fields())

    def _distribution(self, prepared, groups, order, page_number, size, creator, show_not_applicable, show_unfilled):
        rows = []
        for spec in groups:
            for model, catalog, permission, clauses in prepared:
                rows.extend(self._distribution_model(model, catalog, permission, clauses, spec, creator))
        if len(rows) > MAX_BUCKETS:
            raise ValueError(f"分组结果超过 {MAX_BUCKETS} 个，请缩小条件或改分组字段")
        if not show_not_applicable:
            rows = [row for row in rows if row["group_kind"] != KIND_NA]
        if not show_unfilled:
            rows = [row for row in rows if row["group_kind"] != KIND_UNFILLED]
        allowed = {"model_id", "model_name", "group_value", "count", "field_label", "group_kind"}
        rows = _sort_rows(rows, _normalize_order(order, allowed, "-count"))
        return _page_rows(rows, page_number, size, _distribution_fields(groups))

    def _distribution_model(self, model, catalog, permission, clauses, spec, creator):
        source = next((item for item in spec["sources"] if item["model_id"] == model["model_id"]), None)
        if clauses is None:
            return []
        if source is None:
            return [_bucket(model, spec, NOT_APPLICABLE, "", KIND_NA, self._count_model(model, clauses, permission, creator))]
        attr = catalog.get(source["attr_id"])
        if attr is None:
            raise ValueError(f"字段 {source['attr_id']} 不存在，无法分组")
        if not _is_groupable(attr):
            raise ValueError(f"不支持按 {attr.get('attr_name') or source['attr_id']} 分组")
        if len(clauses) > 1:
            return self._distribution_from_rows(model, spec, attr, clauses, permission, creator)
        buckets = self.group_counts(
            group_by_attr=attr["attr_id"],
            permissions_map=permission,
            params=_with_model(model["model_id"], clauses[0] if clauses else []),
            creator=creator or "",
        )
        if not isinstance(buckets, dict):
            raise ValueError("属性分布结果不正确")
        return [_bucket(model, spec, *_group_label(attr, key), _require_total(value)) for key, value in buckets.items()]

    def _distribution_from_rows(self, model, spec, attr, clauses, permission, creator):
        rows, _total = self._load_all(model, clauses, permission, creator)
        counts = {}
        for row in rows:
            label, raw, kind = _group_label(attr, row.get(attr["attr_id"]))
            slot = counts.setdefault((kind, raw, label), 0)
            counts[(kind, raw, label)] = slot + 1
        return [_bucket(model, spec, label, raw, kind, count) for (kind, raw, label), count in counts.items()]

    def _aggregate(self, prepared, metrics, order, page_number, size, creator):
        rows = []
        for model, catalog, permission, clauses in prepared:
            row = {"model_id": model["model_id"], "model_name": model["model_name"]}
            for metric in metrics:
                value, state = self._metric_value(model, catalog, permission, clauses, metric, creator)
                row[metric["key"]] = value
                row[f"{metric['key']}__applicability"] = state
            rows.append(row)
        allowed = {"model_id", "model_name", *[metric["key"] for metric in metrics]}
        rows = _sort_rows(rows, _normalize_order(order, allowed, "model_id"))
        return _page_rows(rows, page_number, size, _aggregate_fields(metrics))

    def _metric_value(self, model, catalog, permission, clauses, metric, creator):
        source = next((item for item in metric["sources"] if item["model_id"] == model["model_id"]), None)
        if source is None:
            return None, NOT_APPLICABLE
        if clauses is None:
            if metric["func"] == "count":
                return 0, "有效"
            return None, UNFILLED
        if metric["func"] == "count":
            return self._count_model(model, clauses, permission, creator), "有效"
        attr = catalog.get(source["attr_id"])
        if attr is None:
            raise ValueError(f"字段 {source['attr_id']} 不存在，无法聚合")
        rows, _total = self._load_all(model, clauses, permission, creator)
        numbers = []
        for row in rows:
            raw = row.get(attr["attr_id"])
            if raw in (None, ""):
                continue
            numbers.append(float(raw))
        if not numbers:
            return None, UNFILLED
        func = metric["func"]
        if func == "sum":
            return _sum_numbers(numbers, attr["attr_type"]), "有效"
        if func == "min":
            return min(numbers), "有效"
        if func == "max":
            return max(numbers), "有效"
        return sum(numbers) / len(numbers), "有效"

    def _count_model(self, model, clauses, permission, creator):
        if clauses is None:
            return 0
        if len(clauses) <= 1:
            _rows, total = self._page_model(model, clauses, permission, creator, 1, 1, DEFAULT_ORDER_FIELD)
            return _require_total(total)
        rows, total = self._load_all(model, clauses, permission, creator)
        return total if total == len({row.get("inst_uuid") for row in rows}) else len(rows)

    def _page_model(self, model, clauses, permission, creator, page, size, order):
        if clauses is None:
            return [], 0
        if len(clauses) <= 1:
            return self.list_instances(
                model_id=model["model_id"],
                params=list(clauses[0] if clauses else []),
                page=page,
                page_size=size,
                order=order,
                permission_map=permission,
                creator=creator or "",
            )
        rows, total = self._load_all(model, clauses, permission, creator)
        start = (page - 1) * size
        return rows[start : start + size], total

    def _load_all(self, model, clauses, permission, creator):
        seen = {}
        for clause in clauses or [[]]:
            _probe, total = self.list_instances(
                model_id=model["model_id"],
                params=list(clause),
                page=1,
                page_size=1,
                order=DEFAULT_ORDER_FIELD,
                permission_map=permission,
                creator=creator or "",
            )
            total = _require_total(total)
            if total > MAX_SCAN:
                raise ValueError(f"匹配实例超过 {MAX_SCAN}，请缩小条件后再查询。系统不会只扫描前 {MAX_SCAN} 条并当成全量结果")
            fetched, fetched_count = self.list_instances(
                model_id=model["model_id"],
                params=list(clause),
                page=1,
                page_size=max(total, 1),
                order=DEFAULT_ORDER_FIELD,
                permission_map=permission,
                creator=creator or "",
            )
            if _require_total(fetched_count) != total or len(fetched or []) < total:
                raise ValueError("实例结果不完整，已中止，不会用部分结果充当全量")
            for row in fetched or []:
                if isinstance(row, dict):
                    seen[str(row.get("inst_uuid") or id(row))] = row
        return list(seen.values()), len(seen)


def _requested_models(model_id, model_ids):
    listed = parse_id_list(model_ids, "模型")
    legacy = []
    if model_id not in (None, "", []):
        if isinstance(model_id, (list, tuple)):
            legacy = parse_id_list(model_id, "模型")
        else:
            legacy = parse_id_list([model_id], "模型")
    if listed and legacy and set(listed) != set(legacy):
        raise ValueError("模型参数冲突")
    return listed or legacy


def _assert_global_condition_types(tree, selected, catalogs):
    """同一全局属性在多个模型上类型或单位不同时，不能当成同一个条件。"""
    for attr_id in _global_condition_attrs(tree):
        signatures = {}
        for model in selected:
            attr = catalogs[model["model_id"]].get(attr_id)
            if not attr:
                continue
            signature = (attr.get("attr_type"), str(attr.get("unit") or ""))
            signatures.setdefault(signature, model["model_name"])
        if len(signatures) > 1:
            names = "、".join(signatures.values())
            raise ValueError(f"全局条件字段 {attr_id} 在 {names} 上的类型或单位不一致")


def _global_condition_attrs(node, found=None):
    found = set() if found is None else found
    if not isinstance(node, dict):
        return found
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            _global_condition_attrs(child, found)
        return found
    scope = str(node.get("scope") or "global").strip() or "global"
    attr_id = str(node.get("attr_id") or "").strip()
    if scope == "global" and attr_id:
        found.add(attr_id)
    return found


def _normalize_conditions(conditions, attr_filters, selected, catalogs):
    if _present(conditions) and _present(attr_filters):
        raise ValueError("不能同时提交结构化条件和旧的属性过滤")
    if _present(conditions):
        if not isinstance(conditions, dict):
            raise ValueError("条件必须是结构化条件树")
        return conditions
    if not _present(attr_filters):
        return None
    if len(selected) != 1:
        raise ValueError("旧的属性过滤必须指定一个模型")
    model_id = selected[0]["model_id"]
    children = []
    for field, value in _parse_legacy_filters(attr_filters):
        attr = catalogs[model_id].get(field)
        if attr is None:
            raise ValueError(f"字段 {field} 不存在，无法过滤")
        operator = "list_any[]" if attr.get("attr_type") == "enum" else _legacy_operator(attr)
        children.append({"scope": model_id, "attr_id": field, "operator": operator, "value": value})
    return {"logic": "and", "children": children}


def _legacy_operator(attr):
    attr_type = attr.get("attr_type")
    if attr_type == "bool":
        return "bool"
    if attr_type in {"int", "float"}:
        return "int="
    if attr_type == "str":
        return "str="
    raise ValueError(f"旧的属性过滤仅支持等值，字段 {attr.get('attr_name') or attr.get('attr_id')} 请改用条件")


def _parse_legacy_filters(raw):
    if not isinstance(raw, str):
        raise ValueError("旧的属性过滤仅支持等值，形如 ip_addr=10.0.0.1，多个条件用分号分隔")
    pairs = []
    for part in _FILTER_SPLIT.split(raw.strip()):
        item = part.strip()
        if not item:
            continue
        if any(mark in item for mark in _LEGACY_MARKS):
            raise ValueError("旧的属性过滤仅支持等值，形如 ip_addr=10.0.0.1，不支持比较或模糊匹配")
        if "=" not in item:
            raise ValueError("旧的属性过滤仅支持等值，形如 ip_addr=10.0.0.1")
        field, value = item.split("=", 1)
        field = field.strip()
        if not field or value.strip() == "":
            raise ValueError("旧的属性过滤需要字段和值，形如 ip_addr=10.0.0.1")
        pairs.append((field, value.strip()))
    return pairs


def _normalize_groups(raw, selected, catalogs):
    if isinstance(raw, str) and raw.strip():
        if len(selected) != 1:
            raise ValueError("分组字段需要指定所属模型")
        model = selected[0]
        attr = catalogs[model["model_id"]].get(raw.strip())
        if attr is None:
            raise ValueError(f"字段 {raw.strip()} 不存在，无法分组")
        return [_group_spec(model, attr, explicit=False)]
    if raw in (None, "", []):
        raise ValueError("属性分布需要选择分组字段")
    if not isinstance(raw, list):
        raise ValueError("分组字段格式不正确")
    specs = []
    for item in raw:
        specs.append(_parse_group_item(item, selected, catalogs))
    if not specs:
        raise ValueError("属性分布需要选择分组字段")
    return specs


def _parse_group_item(item, selected, catalogs):
    if isinstance(item, str):
        return _normalize_groups(item, selected, catalogs)[0]
    if not isinstance(item, dict):
        raise ValueError("分组字段格式不正确")
    sources = _parse_sources(item.get("sources"), selected, catalogs, purpose="分组")
    if len(sources) > 1:
        _assert_compatible(sources, catalogs)
    explicit = len(sources) > 1 or bool(item.get("explicit"))
    label = str(item.get("label") or "").strip()
    if not label:
        first = sources[0]
        attr = catalogs[first["model_id"]][first["attr_id"]]
        model = next(model for model in selected if model["model_id"] == first["model_id"])
        label = _field_label(model["model_name"], attr["attr_name"]) if len(sources) == 1 else str(attr.get("attr_name") or first["attr_id"])
    return {"label": label, "sources": sources, "explicit": explicit, "key": _spec_key(sources)}


def _group_spec(model, attr, explicit):
    source = {"model_id": model["model_id"], "attr_id": attr["attr_id"]}
    return {
        "label": _field_label(model["model_name"], attr["attr_name"]),
        "sources": [source],
        "explicit": explicit,
        "key": _spec_key([source]),
    }


def _normalize_metrics(metrics, agg_field, agg_func, selected, catalogs):
    if _present(metrics) and (_present(agg_field) or _present(agg_func)):
        raise ValueError("不能同时提交指标和旧的聚合字段")
    if not _present(metrics):
        if not _present(agg_field) and not _present(agg_func):
            raise ValueError("数值聚合需要选择指标")
        if len(selected) != 1:
            raise ValueError("旧的聚合字段必须指定一个模型")
        func = str(agg_func or "").strip()
        field = str(agg_field or "").strip()
        if func not in AGGREGATE_FUNCS or not field:
            raise ValueError("数值聚合需要字段和函数 sum、avg、min、max 或 count")
        metrics = [{"label": field, "func": func, "sources": [f"{selected[0]['model_id']}:{field}"]}]
    if not isinstance(metrics, list):
        raise ValueError("指标格式不正确")
    specs = []
    seen = set()
    for item in metrics:
        spec = _parse_metric(item, selected, catalogs)
        if spec["key"] in seen:
            raise ValueError(f"指标 {spec['label']} 重复")
        seen.add(spec["key"])
        specs.append(spec)
    if not specs:
        raise ValueError("数值聚合需要选择指标")
    return specs


def _parse_metric(item, selected, catalogs):
    if not isinstance(item, dict):
        raise ValueError("指标格式不正确")
    func = str(item.get("func") or "").strip()
    if func not in AGGREGATE_FUNCS:
        raise ValueError("聚合函数只支持 count、sum、avg、min、max")
    sources = _parse_sources(item.get("sources"), selected, catalogs, purpose="聚合")
    if len(sources) > 1 and func != "count":
        _assert_compatible(sources, catalogs, func=func)
    else:
        for source in sources:
            _assert_func(source, catalogs, func)
    label = str(item.get("label") or "").strip() or func
    key = str(item.get("key") or "").strip() or _metric_key(func, sources)
    if not _MODEL_ID_PATTERN.fullmatch(key):
        key = _metric_key(func, sources)
    return {"key": key, "label": label, "func": func, "sources": sources, "unit": _shared_unit(sources, catalogs)}


def _parse_sources(raw, selected, catalogs, purpose):
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{purpose}需要选择字段")
    models = {model["model_id"]: model for model in selected}
    sources = []
    for item in raw:
        model_id, attr_id = _split_source(item, models)
        attr = catalogs[model_id].get(attr_id)
        if attr is None:
            raise ValueError(f"字段 {attr_id} 不存在，无法{purpose}")
        sources.append({"model_id": model_id, "attr_id": attr_id, "model_name": models[model_id]["model_name"]})
    return sources


def _split_source(item, models):
    if isinstance(item, str) and ":" in item:
        model_id, attr_id = item.split(":", 1)
    elif isinstance(item, dict):
        model_id = str(item.get("model_id") or "")
        attr_id = str(item.get("attr_id") or "")
    else:
        raise ValueError("字段需要带上所属模型")
    model_id = model_id.strip()
    attr_id = attr_id.strip()
    if model_id not in models:
        raise ValueError("字段引用的模型不在查询范围内")
    if not _MODEL_ID_PATTERN.fullmatch(attr_id):
        raise ValueError("字段标识不正确")
    return model_id, attr_id


def _assert_compatible(sources, catalogs, func=None):
    types = set()
    units = set()
    for source in sources:
        attr = catalogs[source["model_id"]][source["attr_id"]]
        if func:
            _assert_func(source, catalogs, func)
        types.add(attr.get("attr_type"))
        units.add(str(attr.get("unit") or ""))
    if len(types) > 1 or len(units) > 1:
        raise ValueError("字段类型或单位不一致，不能合并")


def _assert_func(source, catalogs, func):
    attr = catalogs[source["model_id"]][source["attr_id"]]
    if func in NUMERIC_FUNCS and attr.get("attr_type") not in {"int", "float"}:
        raise ValueError(f"字段 {attr.get('attr_name') or source['attr_id']} 不能使用 {func}")
    if func == "count" and attr.get("attr_type") not in FILTERABLE_TYPES and source["attr_id"] not in {item["key"] for item in _IDENTITY}:
        raise ValueError(f"字段 {attr.get('attr_name') or source['attr_id']} 不能计数")


def _shared_unit(sources, catalogs):
    units = {str(catalogs[source["model_id"]][source["attr_id"]].get("unit") or "") for source in sources}
    return next(iter(units)) if len(units) == 1 else ""


def _attr_catalog(attrs):
    catalog = {}
    for item in _IDENTITY:
        catalog[item["key"]] = {
            "attr_id": item["key"],
            "attr_name": item["title"],
            "attr_type": item["attr_type"],
            "unit": "",
            "enum_options": [],
        }
    for attr in attrs or []:
        if not isinstance(attr, dict):
            continue
        attr_id = str(attr.get("attr_id") or "").strip()
        if not attr_id or attr_id in catalog or not _MODEL_ID_PATTERN.fullmatch(attr_id):
            continue
        catalog[attr_id] = {
            "attr_id": attr_id,
            "attr_name": str(attr.get("attr_name") or attr_id),
            "attr_type": str(attr.get("attr_type") or ""),
            "unit": str(attr.get("unit") or ""),
            "is_only": bool(attr.get("is_only")),
            "is_required": bool(attr.get("is_required")),
            "is_pre": bool(attr.get("is_pre")),
            "is_display_field": bool(attr.get("is_display_field")),
            "is_system_link": bool(attr.get("is_system_link")),
            "enum_options": attr.get("enum_options") if isinstance(attr.get("enum_options"), list) else _options_from_attr(attr),
        }
    return catalog


def _options_from_attr(attr):
    if attr.get("attr_type") != "enum":
        return []
    option = attr.get("option")
    return option if isinstance(option, list) else []


def _public_enum_options(attr):
    options = []
    for item in attr.get("enum_options") or []:
        if not isinstance(item, dict):
            continue
        option_id = item.get("id", item.get("value"))
        if option_id in (None, ""):
            continue
        options.append({"value": str(option_id), "label": str(item.get("name", item.get("label", option_id)))})
    return options


def _display_candidates(catalog):
    candidates = []
    for index, attr in enumerate(catalog.values()):
        if attr["attr_id"] in {item["key"] for item in _IDENTITY}:
            continue
        if not _is_key_display_attr(attr) and attr.get("attr_type") not in FILTERABLE_TYPES:
            continue
        if attr.get("attr_type") not in FILTERABLE_TYPES and attr["attr_id"] not in {item["key"] for item in _IDENTITY}:
            continue
        candidates.append((index, attr))
    return [attr for _index, attr in candidates]


def _list_fields(prepared):
    fields = identity_fields()
    fields.append({"key": "model_name", "title": "模型名称", "value_type": "string", "role": "dimension", "description": "模型中文名"})
    seen = {field["key"] for field in fields}
    for model, catalog, _permission, _clauses in prepared:
        ranked = []
        for index, attr in enumerate(catalog.values()):
            if not _is_key_display_attr(attr):
                continue
            ranked.append((_display_rank(attr), index, attr))
        ranked.sort()
        for _rank, _index, attr in ranked[:MAX_KEY_ATTRS]:
            key = _field_key(model["model_id"], attr["attr_id"])
            if key in seen:
                continue
            seen.add(key)
            fields.append(
                {
                    "key": key,
                    "title": _field_label(model["model_name"], attr["attr_name"]),
                    "value_type": _VALUE_TYPE_BY_ATTR.get(attr["attr_type"], "string"),
                    "role": "dimension",
                    "unit": str(attr.get("unit") or ""),
                    "description": _field_label(model["model_name"], attr["attr_name"]),
                }
            )
    return fields


def _count_fields():
    return [
        {"key": "model_id", "title": "模型", "value_type": "string", "role": "dimension"},
        {"key": "model_name", "title": "模型名称", "value_type": "string", "role": "dimension"},
        {"key": "count", "title": "数量", "value_type": "number", "role": "metric", "aggregation": "count", "description": "该模型过滤后的实例数"},
        {
            "key": "scope_count",
            "title": "范围内数量",
            "value_type": "number",
            "role": "metric",
            "aggregation": "count",
            "description": "当前范围过滤后的实例总数，不是信封上的行数",
        },
    ]


def _distribution_fields(groups):
    title = groups[0]["label"] if len(groups) == 1 else "分组值"
    return [
        {"key": "model_id", "title": "模型", "value_type": "string", "role": "dimension"},
        {"key": "model_name", "title": "模型名称", "value_type": "string", "role": "dimension"},
        {"key": "field_label", "title": "分组字段", "value_type": "string", "role": "dimension"},
        {"key": "group_value", "title": title, "value_type": "string", "role": "dimension", "description": "枚举显示中文；不适用和未填写与空字符串分开"},
        {"key": "group_raw", "title": "原始值", "value_type": "string", "role": "dimension"},
        {"key": "group_kind", "title": "取值口径", "value_type": "string", "role": "dimension"},
        {"key": "count", "title": "数量", "value_type": "number", "role": "metric", "aggregation": "count"},
    ]


def _aggregate_fields(metrics):
    fields = [
        {"key": "model_id", "title": "模型", "value_type": "string", "role": "dimension"},
        {"key": "model_name", "title": "模型名称", "value_type": "string", "role": "dimension"},
    ]
    for metric in metrics:
        fields.append(
            {
                "key": metric["key"],
                "title": metric["label"],
                "value_type": "number",
                "role": "metric",
                "aggregation": metric["func"],
                "unit": metric.get("unit") or "",
                "description": _metric_description(metric),
            }
        )
        fields.append(
            {
                "key": f"{metric['key']}__applicability",
                "title": f"{metric['label']}·口径",
                "value_type": "string",
                "role": "dimension",
                "description": "有效、未填写或不适用。不适用不是 0",
            }
        )
    return fields


def _metric_description(metric):
    names = "、".join(f"{source['model_name']} · {source['attr_id']}" for source in metric["sources"])
    return f"{metric['func']}：{names}"


def _project_list_row(entity, model, fields):
    row = {}
    for field in fields:
        key = field["key"]
        if key == "model_name":
            row[key] = model["model_name"]
            continue
        if key == "model_id":
            row[key] = entity.get(key) or model["model_id"]
            continue
        if key in {item["key"] for item in _IDENTITY}:
            value = entity.get(key)
            row[key] = value
            continue
        prefix = f"{model['model_id']}:"
        if key.startswith(prefix):
            value = entity.get(key[len(prefix) :])
            row[key] = value
        else:
            row[key] = None
    return row


def _bucket(model, spec, label, raw, kind, count):
    return {
        "model_id": model["model_id"],
        "model_name": model["model_name"],
        "field_key": spec["key"],
        "field_label": spec["label"],
        "group_value": label,
        "group_raw": raw,
        "group_kind": kind,
        "count": count,
    }


def _group_label(attr, key):
    if key is None:
        return UNFILLED, "", KIND_UNFILLED
    if key == "":
        return "", "", KIND_EMPTY
    raw = str(key)
    for option in _public_enum_options(attr):
        if option["value"] == raw:
            return option["label"], raw, KIND_VALUE
    if isinstance(key, bool):
        return ("是" if key else "否"), raw, KIND_VALUE
    return raw, raw, KIND_VALUE


def _order_choice(key, label, modes, attr_type="str"):
    return {
        "key": key,
        "label": label,
        "kind": "order",
        "orderable": True,
        "order_modes": modes,
        "attr_type": attr_type,
        "operators": [],
        "options": [],
        "funcs": [],
    }


def _summary_order_rows(mode):
    rows = [
        _order_choice("model_id", "模型", list(ANALYSIS_MODES)),
        _order_choice("model_name", "模型名称", list(ANALYSIS_MODES)),
        _order_choice("inst_name", "实例名", [ANALYSIS_LIST]),
    ]
    if mode in {ANALYSIS_COUNT, ANALYSIS_DISTRIBUTION}:
        rows.append(_order_choice("count", "数量", [mode], "int"))
    if mode == ANALYSIS_DISTRIBUTION:
        rows.append(_order_choice("group_value", "分组值", [mode]))
    return rows


def _funcs_for(attr_type):
    funcs = [{"value": "count", "label": "实例数量"}]
    if attr_type in {"int", "float"}:
        funcs.extend(
            [
                {"value": "sum", "label": "求和"},
                {"value": "avg", "label": "平均"},
                {"value": "min", "label": "最小"},
                {"value": "max", "label": "最大"},
            ]
        )
    return funcs


def _single_clause(clauses):
    return clauses is not None and len(clauses) <= 1


def _with_model(model_id, clause):
    return [{"field": "model_id", "type": "str=", "value": model_id}, *list(clause)]


def _alias_single_model_order(raw, prepared):
    """旧组件按属性标识排序。只有一个模型时把它收成「模型:属性」。"""
    if not isinstance(raw, str) or len(prepared) != 1:
        return raw
    text = raw.strip()
    if not text:
        return raw
    descending = text.startswith("-")
    field = text[1:] if descending else text
    if ":" in field or field in {item["key"] for item in _IDENTITY} or field == "model_name":
        return raw
    model_id = prepared[0][0]["model_id"]
    if field not in prepared[0][1]:
        return raw
    prefixed = f"{model_id}:{field}"
    return f"-{prefixed}" if descending else prefixed


def _graph_order(order_text, model_id):
    descending = order_text.startswith("-")
    field = order_text[1:] if descending else order_text
    prefix = f"{model_id}:"
    if field.startswith(prefix):
        field = field[len(prefix) :]
    return f"-{field}" if descending else field


def _list_sort_key(model, row, order_text):
    field = order_text[1:] if order_text.startswith("-") else order_text
    if field == "model_name":
        value = model["model_name"]
    elif field.startswith(f"{model['model_id']}:"):
        value = row.get(field.split(":", 1)[1])
    else:
        value = row.get(field)
    return (value is None, "" if value is None else value)


def _normalize_order(raw, allowed, default):
    if raw in (None, ""):
        text = default
    elif not isinstance(raw, str):
        raise ValueError("排序必须是字段名，降序加 - 前缀")
    else:
        text = raw.strip() or default
    if any(mark in text for mark in (",", " ")):
        raise ValueError("暂不支持多字段排序")
    field = text[1:] if text.startswith("-") else text
    if field not in allowed:
        raise ValueError(f"不支持按 {field or text} 排序")
    return text


def _sort_rows(rows, order):
    descending = order.startswith("-")
    field = order[1:] if descending else order

    def sort_key(row):
        value = row.get(field)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            normalized = value
        else:
            normalized = str(value)
        return (value is None, normalized, str(row.get("model_id") or ""))

    return sorted(rows, key=sort_key, reverse=descending)


def _page_rows(rows, page, size, fields):
    start = (page - 1) * size
    return {"items": rows[start : start + size], "count": len(rows), "fields": fields}


def _public_field(attr):
    return {"key": attr["key"], "title": attr["title"], "value_type": attr["value_type"], "role": attr.get("role") or "dimension"}


def _field_key(model_id, attr_id):
    if attr_id in {item["key"] for item in _IDENTITY}:
        return attr_id
    return f"{model_id}:{attr_id}"


def _field_label(model_name, attr_name):
    return f"{model_name} · {attr_name}"


def _spec_key(sources):
    return "__".join(f"{source['model_id']}_{source['attr_id']}" for source in sources)


def _metric_key(func, sources):
    return f"{func}_{_spec_key(sources)}"


def _is_key_display_attr(attr):
    if attr.get("is_display_field") or attr.get("is_system_link"):
        return False
    attr_id = attr.get("attr_id") or ""
    if attr_id in _SKIP_ATTR_IDS or attr_id.startswith("_") or attr_id in {item["key"] for item in _IDENTITY}:
        return False
    return attr.get("attr_type") in _SORTABLE_TYPES


def _is_groupable(attr):
    if attr["attr_id"] in {item["key"] for item in _IDENTITY if item["key"] != "model_id"}:
        return True
    return _is_key_display_attr(attr)


def _display_rank(attr):
    if attr.get("is_only"):
        return 0
    if attr.get("is_required"):
        return 1
    if attr.get("is_pre"):
        return 2
    return 3


def _present(raw):
    if raw is None:
        return False
    if isinstance(raw, str):
        return bool(raw.strip())
    if isinstance(raw, (list, dict)):
        return len(raw) > 0
    return True


def _parse_flag(value, default):
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().lower()
        if token in {"true", "1", "yes"}:
            return True
        if token in {"false", "0", "no"}:
            return False
    raise ValueError("展示开关必须是布尔值")


def _parse_positive(value, name, default, maximum):
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


def _require_total(count):
    try:
        number = int(count)
    except (TypeError, ValueError) as exc:
        raise ValueError("数量结果不正确") from exc
    if isinstance(count, float) and number != count:
        raise ValueError("数量结果不正确")
    if number < 0:
        raise ValueError("数量结果不正确")
    return number


def _sum_numbers(numbers, attr_type):
    total = sum(numbers)
    if attr_type == "int" and float(total).is_integer():
        return int(total)
    return total


def _enrich_enum_options(attr):
    """供 NATS 适配层调用，避免查询服务直接读枚举库。"""
    if not isinstance(attr, dict) or attr.get("attr_type") != "enum":
        return attr
    if isinstance(attr.get("enum_options"), list) and attr["enum_options"]:
        return attr
    from apps.cmdb.services.model import ModelManage

    resolved = ModelManage.resolve_runtime_enum_options(attr)
    copied = dict(attr)
    copied["enum_options"] = resolved if isinstance(resolved, list) else []
    return copied
