# -- coding: utf-8 --
"""仪表盘/大屏 YAML 权威交付：稳定键、目录路径与导入策略。

只覆盖 dashboard 与 screen。其它画布类型继续走原有名称导入导出。
内置对象仍以 build_in_key 为身份，用户稳定键不得占用任一内置键。
"""

from __future__ import annotations

import uuid
from enum import Enum

from apps.operation_analysis.constants.import_export import (
    BUSINESS_KEY_SEPARATOR,
    ConflictAction,
    ImportExportErrorCode,
    ObjectType,
)
from apps.operation_analysis.models.datasource_models import DataSourceAPIModel
from apps.operation_analysis.models.models import Architecture, Dashboard, Directory, NetworkTopology, Report, Screen, Topology
from apps.operation_analysis.services.user_messages import oa_message

STABLE_CANVAS_OBJECT_TYPES = frozenset({ObjectType.DASHBOARD, ObjectType.SCREEN})
STABLE_CANVAS_MODELS = {
    ObjectType.DASHBOARD: Dashboard,
    ObjectType.SCREEN: Screen,
}
DIRECTORY_PATH_SEPARATOR = "/"
CANVAS_KEY_MAX_LENGTH = 255
_BUILTIN_KEY_MODELS = (
    Directory,
    Dashboard,
    Topology,
    Architecture,
    Screen,
    Report,
    NetworkTopology,
    DataSourceAPIModel,
)


class ConflictPolicy(str, Enum):
    SKIP = "skip"
    OVERWRITE = "overwrite"
    RENAME = "rename"
    KEY_OVERWRITE = "key_overwrite"


class DatasourceResolve(str, Enum):
    PREFER_EXISTING = "prefer_existing"
    PACKAGE = "package"


class DirectoryPathError(Exception):
    def __init__(self, code: str, path: str):
        self.code = code
        self.path = path
        super().__init__(code)


def normalized_canvas_key(item) -> str:
    if item is None:
        return ""
    if isinstance(item, dict):
        value = item.get("canvas_key")
    else:
        value = getattr(item, "canvas_key", None)
    if value is None:
        return ""
    return str(value).strip()


def normalized_directory_path(item) -> str:
    if item is None:
        return ""
    if isinstance(item, dict):
        value = item.get("directory_path")
    else:
        value = getattr(item, "directory_path", None)
    if value is None:
        return ""
    return str(value).strip()


def supports_user_canvas_key(object_type: ObjectType) -> bool:
    return object_type in STABLE_CANVAS_OBJECT_TYPES


def effective_datasource_resolve(conflict_policy: str | None, explicit: str | None) -> str:
    if explicit:
        return explicit
    if conflict_policy == ConflictPolicy.KEY_OVERWRITE.value:
        return DatasourceResolve.PREFER_EXISTING.value
    return DatasourceResolve.PACKAGE.value


def uses_directory_path(conflict_policy: str | None) -> bool:
    return conflict_policy == ConflictPolicy.KEY_OVERWRITE.value


def resolve_conflict_action(
    *,
    object_type: ObjectType,
    object_key: str,
    conflict_decisions: dict[str, str],
    conflict_policy: str | None,
    datasource_resolve: str | None,
) -> str:
    """逐对象决策优先；整包策略只填没有显式决策的对象。"""
    if object_key in conflict_decisions:
        return conflict_decisions[object_key]
    if conflict_policy == ConflictPolicy.KEY_OVERWRITE.value:
        if object_type in STABLE_CANVAS_OBJECT_TYPES:
            return ConflictAction.OVERWRITE.value
        if object_type == ObjectType.DATASOURCE:
            if datasource_resolve == DatasourceResolve.PREFER_EXISTING.value:
                return ConflictAction.SKIP.value
            return ConflictAction.OVERWRITE.value
        if object_type == ObjectType.NAMESPACE:
            return ConflictAction.SKIP.value
        return ConflictAction.RENAME.value
    if conflict_policy in {
        ConflictPolicy.SKIP.value,
        ConflictPolicy.OVERWRITE.value,
        ConflictPolicy.RENAME.value,
    }:
        return conflict_policy
    return ConflictAction.RENAME.value


def canvas_keys_occupied_by_builtin(keys: list[str]) -> set[str]:
    normalized = [key for key in dict.fromkeys(keys) if key]
    if not normalized:
        return set()
    occupied: set[str] = set()
    for model in _BUILTIN_KEY_MODELS:
        occupied.update(model.objects.filter(build_in_key__in=normalized).values_list("build_in_key", flat=True))
    return occupied


def allocate_canvas_key(model, object_type: ObjectType) -> str:
    sibling = Screen if model is Dashboard else Dashboard if model is Screen else None
    for _ in range(5):
        candidate = f"{object_type.value}{BUSINESS_KEY_SEPARATOR}{uuid.uuid4().hex}"
        if len(candidate) > CANVAS_KEY_MAX_LENGTH:
            continue
        if model.objects.filter(canvas_key=candidate).exists() or model.objects.filter(build_in_key=candidate).exists():
            continue
        if sibling is not None and sibling.objects.filter(build_in_key=candidate).exists():
            continue
        return candidate
    raise RuntimeError("无法生成画布稳定键")


def ensure_stored_canvas_key(instance, object_type: ObjectType) -> str:
    """已落库且尚无用户稳定键时生成并写回。草稿桩对象与内置画布不写。"""
    if object_type not in STABLE_CANVAS_OBJECT_TYPES or not hasattr(instance, "canvas_key"):
        return ""
    current = (getattr(instance, "canvas_key", None) or "").strip()
    if current or getattr(instance, "is_build_in", False) or not getattr(instance, "pk", None):
        return current
    candidate = allocate_canvas_key(instance.__class__, object_type)
    instance.canvas_key = candidate
    instance.save(update_fields=["canvas_key", "updated_at"])
    return candidate


def format_directory_path(directory: Directory | None) -> str:
    if directory is None:
        return ""
    chain = []
    current = directory
    seen = set()
    while current is not None:
        marker = ("pk", current.pk) if current.pk is not None else ("obj", id(current))
        if marker in seen or len(chain) > 8:
            raise DirectoryPathError("cycle", "")
        seen.add(marker)
        chain.append(current)
        current = current.parent
    chain.reverse()
    return DIRECTORY_PATH_SEPARATOR.join(item.name for item in chain)


def resolve_directory_path(path: str) -> Directory:
    raw = (path or "").strip()
    if not raw or raw.startswith(DIRECTORY_PATH_SEPARATOR) or raw.endswith(DIRECTORY_PATH_SEPARATOR):
        raise DirectoryPathError(ImportExportErrorCode.IMPORT_DIRECTORY_PATH_INVALID, raw)
    if DIRECTORY_PATH_SEPARATOR * 2 in raw:
        raise DirectoryPathError(ImportExportErrorCode.IMPORT_DIRECTORY_PATH_INVALID, raw)
    parent = None
    current = None
    for part in raw.split(DIRECTORY_PATH_SEPARATOR):
        matches = list(Directory.objects.filter(name=part, parent=parent)[:2])
        if not matches:
            raise DirectoryPathError(ImportExportErrorCode.IMPORT_DIRECTORY_PATH_NOT_FOUND, raw)
        if len(matches) > 1:
            raise DirectoryPathError(ImportExportErrorCode.IMPORT_DIRECTORY_PATH_INVALID, raw)
        current = matches[0]
        parent = current
    return current


def index_existing_canvases(model, items) -> dict:
    """无 canvas_key 时按名称索引，保持原批量查询；有键时键优先、不再回落到名称。"""
    keys = [normalized_canvas_key(item) for item in items if normalized_canvas_key(item)]
    if not keys:
        return {obj.name: obj for obj in model.objects.filter(name__in=[item.name for item in items])}

    result = {}
    for obj in model.objects.filter(canvas_key__in=keys):
        result[("canvas_key", obj.canvas_key)] = obj
    names = [item.name for item in items if not normalized_canvas_key(item)]
    if names:
        for obj in model.objects.filter(name__in=names):
            result[obj.name] = obj
    return result


def canvas_lookup_key(object_type: ObjectType, item):
    if object_type == ObjectType.DATASOURCE:
        return (item.name, item.rest_api)
    if object_type in STABLE_CANVAS_OBJECT_TYPES:
        canvas_key = normalized_canvas_key(item)
        if canvas_key:
            return ("canvas_key", canvas_key)
    return item.name


def builtin_key_rejected_message() -> str:
    return oa_message("messages.import_builtin_key_rejected", "用户稳定键与内置键冲突，已拒绝导入")


def builtin_protected_message() -> str:
    return oa_message("messages.import_builtin_protected", "不能修改内置画布")


def canvas_name_taken_message(name: str) -> str:
    return oa_message("messages.import_canvas_name_taken", "画布名称已被其他对象占用: {name}", name=name)


def directory_path_required_message() -> str:
    return oa_message("messages.import_directory_path_required", "仪表盘/大屏缺少 directory_path，且未提供目录参数")


def directory_missing_message() -> str:
    return oa_message("messages.import_directory_missing", "目标目录不存在")


def directory_path_error_message(exc: DirectoryPathError) -> str:
    if exc.code == ImportExportErrorCode.IMPORT_DIRECTORY_PATH_NOT_FOUND:
        return oa_message("messages.import_directory_path_not_found", "directory_path 对应的目录不存在: {path}", path=exc.path)
    return oa_message("messages.import_directory_path_invalid", "directory_path 不合法: {path}", path=exc.path)


def duplicated_canvas_key_message(canvas_key: str) -> str:
    return oa_message("messages.import_canvas_key_duplicated", "YAML 中稳定键重复: {canvas_key}", canvas_key=canvas_key)


def datasource_reused_message() -> str:
    return oa_message("messages.import_datasource_reused", "复用已有数据源，未覆盖源定义")


def import_call_options(data: dict) -> dict:
    policy = data.get("conflict_policy") or None
    resolve = effective_datasource_resolve(policy, data.get("datasource_resolve") or None)
    return {
        "target_directory_id": data.get("target_directory_id"),
        "conflict_policy": policy,
        "datasource_resolve": resolve,
        "use_directory_path": uses_directory_path(policy),
    }
