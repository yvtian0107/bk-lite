# -- coding: utf-8 --
"""数据包里的数据源身份。

本地库仍用数字主键。跨环境只认内置 build_in_key 和用户 portable_key。
包内句柄是 builtin::{build_in_key} 或 portable::{portable_key}，不是目标库的 id，
也不是名称或接口地址。
"""

from __future__ import annotations

import json
from typing import Any

from apps.operation_analysis.constants.import_export import is_sensitive_field_name
from apps.operation_analysis.models.datasource_models import DataSourceAPIModel
from apps.operation_analysis.services.string_param_multiple_migrate import migrate_param_items

BUILTIN_HANDLE_PREFIX = "builtin::"
PORTABLE_HANDLE_PREFIX = "portable::"


def package_handle_for_row(row: DataSourceAPIModel) -> str | None:
    if row.is_build_in and row.build_in_key:
        return f"{BUILTIN_HANDLE_PREFIX}{row.build_in_key}"
    if row.portable_key:
        return f"{PORTABLE_HANDLE_PREFIX}{row.portable_key}"
    return None


def is_package_handle(value: str) -> bool:
    return value.startswith(BUILTIN_HANDLE_PREFIX) or value.startswith(PORTABLE_HANDLE_PREFIX)


def find_identity_row(item, *, lock: bool = False) -> DataSourceAPIModel | None:
    """只按稳定身份找目标行。没有身份字段时不按名称或接口地址认领。"""
    identity = getattr(item, "identity", None)
    if identity is None:
        return None
    queryset = DataSourceAPIModel.objects.all()
    if lock:
        queryset = queryset.select_for_update()
    if identity.kind == "builtin" and identity.build_in_key:
        return queryset.filter(build_in_key=identity.build_in_key, is_build_in=True).first()
    if identity.kind == "portable" and identity.portable_key:
        return queryset.filter(portable_key=identity.portable_key, is_build_in=False).first()
    return None


def resolve_package_handle(value: Any, key_map: dict[Any, Any]) -> int | None:
    """把包内句柄或本包数据源键解成这次导入得到的目标 id。"""
    if not isinstance(value, str) or not value:
        return None
    candidates = [value]
    if value.startswith(BUILTIN_HANDLE_PREFIX):
        candidates.append(value[len(BUILTIN_HANDLE_PREFIX) :])
    elif value.startswith(PORTABLE_HANDLE_PREFIX):
        candidates.append(value[len(PORTABLE_HANDLE_PREFIX) :])
    else:
        candidates.append(f"{BUILTIN_HANDLE_PREFIX}{value}")
        candidates.append(f"{PORTABLE_HANDLE_PREFIX}{value}")
    for candidate in candidates:
        mapped = key_map.get(candidate)
        if isinstance(mapped, int) and not isinstance(mapped, bool):
            return mapped
    return None


def rewrite_datasource_bindings(value: Any, key_map: dict[Any, Any]) -> Any:
    """同一套遍历：组件主数据源、参数里的选项源、筛选器和条件字段。"""
    if isinstance(value, list):
        return [rewrite_datasource_bindings(item, key_map) for item in value]
    if not isinstance(value, dict):
        return value

    cloned = {key: rewrite_datasource_bindings(item, key_map) for key, item in value.items()}
    value_config = cloned.get("valueConfig")
    if isinstance(value_config, dict):
        data_source = value_config.get("dataSource")
        if data_source in key_map:
            value_config = dict(value_config)
            value_config["dataSource"] = key_map[data_source]
            cloned["valueConfig"] = value_config
        elif isinstance(data_source, str):
            mapped = resolve_package_handle(data_source, key_map)
            if mapped is not None:
                value_config = dict(value_config)
                value_config["dataSource"] = mapped
                cloned["valueConfig"] = value_config

    if "sourceId" in cloned or "sourceRef" in cloned:
        cloned = _rewrite_option_source(cloned, key_map)
    return cloned


def _rewrite_option_source(node: dict, key_map: dict[Any, Any]) -> dict:
    source_id = node.get("sourceId")
    if source_id in key_map and isinstance(key_map[source_id], str):
        rewritten = {key: value for key, value in node.items() if key not in {"sourceId", "sourceSnapshot", "builtinKey"}}
        rewritten["sourceRef"] = {"type": "rest_api", "value": key_map[source_id]}
        return rewritten

    source_ref = node.get("sourceRef")
    ref_value = source_ref.get("value") if isinstance(source_ref, dict) else None
    mapped = resolve_package_handle(ref_value, key_map)
    if mapped is None:
        if isinstance(source_id, int) and not isinstance(source_id, bool) and source_id not in key_map:
            # 数字 id 不能带出本环境。留下还能看懂的 sourceRef，没有就去掉这条绑定。
            return {key: value for key, value in node.items() if key != "sourceId"}
        return node

    rewritten = {key: value for key, value in node.items() if key not in {"sourceRef", "sourceSnapshot", "builtinKey", "sourceId"}}
    rewritten["sourceId"] = mapped
    if isinstance(ref_value, str) and ref_value.startswith(BUILTIN_HANDLE_PREFIX):
        rewritten["builtinKey"] = ref_value[len(BUILTIN_HANDLE_PREFIX) :]
    return rewritten


def unresolved_package_handles(value: Any, key_map: dict[Any, Any], package_keys: set[str]) -> list[str]:
    """本包声明了、但这次没有导入成功的句柄。遗留纯路径不算。"""
    missing: list[str] = []

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        value_config = node.get("valueConfig")
        if isinstance(value_config, dict):
            data_source = value_config.get("dataSource")
            if isinstance(data_source, str) and _must_resolve(data_source, package_keys) and resolve_package_handle(data_source, key_map) is None:
                missing.append(data_source)
        source_ref = node.get("sourceRef")
        if isinstance(source_ref, dict):
            ref_value = source_ref.get("value")
            if isinstance(ref_value, str) and _must_resolve(ref_value, package_keys) and resolve_package_handle(ref_value, key_map) is None:
                missing.append(ref_value)
        for child in node.values():
            visit(child)

    visit(value)
    return list(dict.fromkeys(missing))


def _must_resolve(value: str, package_keys: set[str]) -> bool:
    return is_package_handle(value) or value in package_keys


def collect_numeric_source_ids(value: Any) -> set[int]:
    found: set[int] = set()

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        value_config = node.get("valueConfig")
        if isinstance(value_config, dict):
            data_source = value_config.get("dataSource")
            if isinstance(data_source, int) and not isinstance(data_source, bool):
                found.add(data_source)
        source_id = node.get("sourceId")
        if isinstance(source_id, int) and not isinstance(source_id, bool):
            found.add(source_id)
        for child in node.values():
            visit(child)

    visit(value)
    return found


def collect_source_ref_values(value: Any) -> set[str]:
    found: set[str] = set()

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        source_ref = node.get("sourceRef")
        if isinstance(source_ref, dict) and isinstance(source_ref.get("value"), str) and source_ref.get("value"):
            found.add(source_ref["value"])
        for child in node.values():
            visit(child)

    visit(value)
    return found


def unique_builtin_ids_for_refs(refs: set[str]) -> set[int]:
    """只收全表恰好一个内置键的引用。同路径多条时不猜测。"""
    if not refs:
        return set()
    grouped: dict[str, list[int]] = {}
    for key, row_id in DataSourceAPIModel.objects.filter(build_in_key__in=refs, is_build_in=True).values_list("build_in_key", "id"):
        grouped.setdefault(key, []).append(row_id)
    return {row_ids[0] for row_ids in grouped.values() if len(row_ids) == 1}


def expand_datasource_closure(datasource_ids: set[int], *, lock: bool = False) -> set[int]:
    """先把数据源收齐，再顺着参数里的嵌套选项源往下走。环用已访问集合截断。"""
    seen: set[int] = set()
    pending = {item for item in datasource_ids if isinstance(item, int)}
    while pending - seen:
        batch = pending - seen
        seen |= batch
        queryset = DataSourceAPIModel.objects.filter(id__in=batch)
        if lock:
            queryset = queryset.select_for_update()
        pending = set()
        refs: set[str] = set()
        for row in queryset:
            pending |= collect_numeric_source_ids(row.params)
            refs |= collect_source_ref_values(row.params)
        pending |= unique_builtin_ids_for_refs(refs)
        pending -= seen
    return seen


def business_config_equal(item, row: DataSourceAPIModel) -> bool:
    """比较业务配置。忽略主键、时间、名称、身份和组织名单。嵌套引用换成稳定句柄。"""
    id_to_handle, alias_to_handle = _stable_handle_index()
    left = _canonical_config(_payload_from_item(item), alias_to_handle, id_to_handle=None)
    right = _canonical_config(_payload_from_row(row), alias_to_handle, id_to_handle=id_to_handle)
    return _stable_json(left) == _stable_json(right)


def _stable_handle_index() -> tuple[dict[int, str], dict[str, str]]:
    id_to_handle: dict[int, str] = {}
    alias_to_handle: dict[str, str] = {}
    for row_id, is_build_in, build_in_key, portable_key in DataSourceAPIModel.objects.values_list(
        "id",
        "is_build_in",
        "build_in_key",
        "portable_key",
    ):
        handle = None
        if is_build_in and build_in_key:
            handle = f"{BUILTIN_HANDLE_PREFIX}{build_in_key}"
            alias_to_handle[build_in_key] = handle
            alias_to_handle[handle] = handle
        elif portable_key:
            handle = f"{PORTABLE_HANDLE_PREFIX}{portable_key}"
            alias_to_handle[portable_key] = handle
            alias_to_handle[handle] = handle
        if handle:
            id_to_handle[row_id] = handle
    return id_to_handle, alias_to_handle


def _payload_from_item(item) -> dict:
    params, _warnings = migrate_param_items(item.params or [])
    return {
        "rest_api": item.rest_api or "",
        "source_type": item.source_type,
        "desc": item.desc or "",
        "params": params,
        "query_config": item.query_config or {},
        "transform_config": _canonical_transform(item.transform_config),
        "chart_type": item.chart_type or [],
        "field_schema": item.field_schema or [],
        "connection_config": item.connection_config or {},
    }


def _payload_from_row(row: DataSourceAPIModel) -> dict:
    params, _warnings = migrate_param_items(row.params or [])
    return {
        "rest_api": row.rest_api or "",
        "source_type": row.source_type,
        "desc": row.desc or "",
        "params": params,
        "query_config": row.query_config or {},
        "transform_config": _canonical_transform(row.transform_config),
        "chart_type": row.chart_type or [],
        "field_schema": row.field_schema or [],
        "connection_config": row.connection_config or {},
    }


def _canonical_config(payload: dict, alias_to_handle: dict[str, str], *, id_to_handle: dict[int, str] | None) -> dict:
    cloned = _strip_sensitive(payload)
    return _canonicalize_tree(cloned, alias_to_handle, id_to_handle)


def _canonical_transform(config: Any) -> dict:
    """空转换配置和导入时补上的默认关闭脚本看成同一份。"""
    if not isinstance(config, dict):
        config = {}
    enabled = bool(config.get("enabled"))
    script = config.get("script") if isinstance(config.get("script"), str) else ""
    language = config.get("language") if isinstance(config.get("language"), str) and config.get("language") else "python"
    if enabled and not script.strip():
        return {"enabled": False, "language": "python", "script": ""}
    if not enabled and not script and language == "python":
        return {"enabled": False, "language": "python", "script": ""}
    return {"enabled": enabled, "language": language, "script": script}


def _strip_sensitive(value: Any) -> Any:
    if isinstance(value, list):
        return [_strip_sensitive(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: _strip_sensitive(item) for key, item in value.items() if not is_sensitive_field_name(str(key))}


def _canonicalize_tree(value: Any, alias_to_handle: dict[str, str], id_to_handle: dict[int, str] | None) -> Any:
    if isinstance(value, list):
        return [_canonicalize_tree(item, alias_to_handle, id_to_handle) for item in value]
    if not isinstance(value, dict):
        return value
    cloned = {
        key: _canonicalize_tree(item, alias_to_handle, id_to_handle) for key, item in value.items() if key not in {"sourceSnapshot", "builtinKey"}
    }
    source_ref = cloned.get("sourceRef")
    if isinstance(source_ref, dict) and isinstance(source_ref.get("value"), str):
        source_ref = dict(source_ref)
        source_ref["value"] = alias_to_handle.get(source_ref["value"], source_ref["value"])
        cloned["sourceRef"] = source_ref
    if id_to_handle is None:
        return cloned
    source_id = cloned.get("sourceId")
    if isinstance(source_id, int) and not isinstance(source_id, bool) and source_id in id_to_handle:
        cloned.pop("sourceId", None)
        cloned["sourceRef"] = {"type": "rest_api", "value": id_to_handle[source_id]}
    value_config = cloned.get("valueConfig")
    if isinstance(value_config, dict):
        data_source = value_config.get("dataSource")
        if isinstance(data_source, int) and not isinstance(data_source, bool) and data_source in id_to_handle:
            value_config = dict(value_config)
            value_config["dataSource"] = id_to_handle[data_source]
            cloned["valueConfig"] = value_config
    return cloned


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
