# -- coding: utf-8 --
"""
YAML导入执行服务

负责执行YAML导入操作，包括：
- 冲突决策处理（skip/overwrite/rename）
- 依赖顺序导入（namespace -> datasource -> canvas）
- 事务原子性保证
- 导入结果统计

Tech Plan参考：
- 2.1.5 /import/submit/ 接口
- 5.3 导入执行流程
"""

from copy import deepcopy

from django.db import IntegrityError, transaction

from apps.core.logger import operation_analysis_logger as logger
from apps.operation_analysis.common.datasource_security import LEGACY_RAW_MONITOR_QUERY_ERROR, is_legacy_raw_monitor_query
from apps.operation_analysis.constants.canvas_refresh import CANVAS_REFRESH_OBJECT_TYPES, normalize_canvas_refresh_interval
from apps.operation_analysis.constants.import_export import (
    RENAME_SUFFIX,
    SENSITIVE_PLACEHOLDER,
    ConflictAction,
    ImportExportErrorCode,
    ImportStatus,
    ObjectType,
    is_sensitive_field_name,
)
from apps.operation_analysis.services.import_export.canvas_authority import (
    DIRECTORY_RESOLUTION_ERROR_CODES,
    ConflictPolicy,
    DatasourceResolve,
    DirectoryPathError,
    allocate_canvas_key,
    duplicated_canvas_key_message,
    builtin_key_rejected_message,
    builtin_protected_message,
    canvas_datasource_missing_target_message,
    canvas_key_taken_message,
    canvas_keys_occupied_by_builtin,
    canvas_name_taken_message,
    datasource_reused_message,
    directory_missing_message,
    directory_path_error_message,
    directory_path_required_message,
    effective_datasource_resolve,
    ensure_directory_visible,
    find_existing_datasource_by_key,
    normalized_canvas_key,
    normalized_directory_path,
    package_org_diverged_message,
    resolve_conflict_action,
    resolve_directory_path,
    supports_user_canvas_key,
    user_canvas_key_may_keep_reserved_key,
    uses_directory_path,
)
from apps.operation_analysis.models.datasource_models import DataSourceAPIModel, DataSourceTag, NameSpace
from apps.operation_analysis.models.models import Architecture, Dashboard, Directory, NetworkTopology, Report, Screen, Topology
from apps.operation_analysis.schemas.import_export_schema import (
    ArchitectureItem,
    DashboardItem,
    DatasourceItem,
    NamespaceItem,
    NetworkTopologyItem,
    ReportItem,
    ScreenItem,
    TopologyItem,
    YAMLDocument,
)
from apps.operation_analysis.services.import_export.view_sets import rewrite_canvas_view_sets_refs_for_storage
from apps.operation_analysis.services.string_param_multiple_migrate import migrate_filters_payload, migrate_param_items
from apps.operation_analysis.services.user_messages import oa_message


class ImportService:
    """
    YAML导入执行服务

    遵循Tech Plan 5.3节导入流程：
    1. 依赖顺序导入：namespace -> datasource -> canvas
    2. 冲突处理：根据conflict_decisions执行skip/overwrite/rename
    3. 敏感字段补充：从secret_supplements中获取
    4. 原子事务：全成功或全回滚
    """

    MODEL_MAP = {
        ObjectType.DASHBOARD: Dashboard,
        ObjectType.TOPOLOGY: Topology,
        ObjectType.ARCHITECTURE: Architecture,
        ObjectType.SCREEN: Screen,
        ObjectType.REPORT: Report,
        ObjectType.NETWORK_TOPOLOGY: NetworkTopology,
        ObjectType.DATASOURCE: DataSourceAPIModel,
        ObjectType.NAMESPACE: NameSpace,
    }

    def __init__(
        self,
        doc: YAMLDocument,
        target_directory_id: int | None,
        conflict_decisions: dict[str, str],
        secret_supplements: dict[str, dict[str, str]],
        created_by: str = "",
        updated_by: str = "",
        groups: list[int] | None = None,
        existing_canvas_ids: dict[tuple[str, str], int] | None = None,
        preserve_existing_canvas_groups: bool = False,
        datasource_groups: list[int] | None = None,
        conflict_policy: str | None = None,
        datasource_resolve: str | None = None,
        use_directory_path: bool | None = None,
        assign_user_canvas_key: bool = True,
        inherit_directory_groups: bool = False,
        current_team: int | None = None,
        enforce_directory_visibility: bool = False,
        directory_visibility_superuser: bool = False,
    ):
        """
        初始化导入服务

        Args:
            doc: 预检通过的YAMLDocument对象
            target_directory_id: 画布对象目标目录ID
            conflict_decisions: 冲突决策，key为object_key，value为skip/overwrite/rename
            secret_supplements: 敏感字段补充，key为object_key，value为{field: value}
            created_by: 创建者
            updated_by: 更新者
            groups: 导入画布所属的组织ID列表
            existing_canvas_ids: 由受信调用方按（对象类型，稳定键）解析的存量画布 ID
            preserve_existing_canvas_groups: 覆盖存量画布时保留其组织可见性配置
            datasource_groups: 新建数据源的组织名单；None 时沿用 groups
        """
        self.doc = doc
        self.target_directory_id = target_directory_id
        self.conflict_decisions = conflict_decisions
        self.secret_supplements = secret_supplements
        self.created_by = created_by
        self.updated_by = updated_by
        self.groups = groups or []
        self.datasource_groups = self.groups if datasource_groups is None else list(datasource_groups)
        self.existing_canvas_ids = existing_canvas_ids or {}
        self.preserve_existing_canvas_groups = preserve_existing_canvas_groups
        self.conflict_policy = conflict_policy or None
        self.datasource_resolve = effective_datasource_resolve(self.conflict_policy, datasource_resolve)
        self.use_directory_path = uses_directory_path(self.conflict_policy) if use_directory_path is None else use_directory_path
        self.assign_user_canvas_key = assign_user_canvas_key
        self.inherit_directory_groups = inherit_directory_groups or self.conflict_policy == ConflictPolicy.KEY_OVERWRITE.value
        self.current_team = current_team
        self.enforce_directory_visibility = enforce_directory_visibility
        self.directory_visibility_superuser = directory_visibility_superuser
        self._builtin_key_blocklist: set[str] = set()

        # 导入过程中的映射表：YAML key -> DB ID
        self.namespace_key_to_id: dict[str, int] = {}
        self.datasource_key_to_id: dict[str, int] = {}
        self.tag_name_to_id: dict[str, int] = {}

        # 导入结果统计
        self.results: list[dict] = []

    def _get_conflict_action(self, object_key: str, object_type: ObjectType) -> str:
        """获取对象的冲突处理策略。未显式决策时，页面导入仍默认 rename。"""
        return resolve_conflict_action(
            object_type=object_type,
            object_key=object_key,
            conflict_decisions=self.conflict_decisions,
            conflict_policy=self.conflict_policy,
            datasource_resolve=self.datasource_resolve,
        )

    def _get_secret_value(self, object_key: str, field: str, default: str = "") -> str:
        """获取敏感字段的补充值"""
        supplements = self.secret_supplements.get(object_key, {})
        return supplements.get(field, default)

    @staticmethod
    def _nested_value(value, path):
        current = value
        for item in path:
            if isinstance(item, str) and isinstance(current, dict):
                current = current.get(item)
            elif isinstance(item, int) and isinstance(current, list) and item < len(current):
                current = current[item]
            else:
                return None
        return current

    def _normalize_transform_config(self, ds_item) -> dict:
        config = getattr(ds_item, "transform_config", None)
        if not isinstance(config, dict):
            return {}
        enabled = bool(config.get("enabled"))
        script = config.get("script") if isinstance(config.get("script"), str) else ""
        if enabled and not script.strip():
            return {"enabled": False, "language": "python", "script": ""}
        return {
            "enabled": enabled,
            "language": "python",
            "script": script,
        }

    def _resolve_config_placeholders(self, object_key: str, field: str, config: dict, existing: dict | None = None):
        """用显式补密值或覆盖目标中的原值替换连接器配置里的脱敏占位符。"""
        resolved = deepcopy(config)
        missing = []
        supplements = self.secret_supplements.get(object_key, {})

        def visit(value, path, display_path):
            if isinstance(value, dict):
                for key, item in value.items():
                    item_path = (*path, key)
                    item_display_path = f"{display_path}.{key}"
                    if item == SENSITIVE_PLACEHOLDER and is_sensitive_field_name(key):
                        replacement = supplements.get(item_display_path, supplements.get(str(key)))
                        if replacement in (None, "", SENSITIVE_PLACEHOLDER) and existing is not None:
                            replacement = self._nested_value(existing, item_path)
                        if replacement in (None, "", SENSITIVE_PLACEHOLDER):
                            missing.append(item_display_path)
                        else:
                            value[key] = replacement
                    else:
                        visit(item, item_path, item_display_path)
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    visit(item, (*path, index), f"{display_path}[{index}]")

        visit(resolved, (), field)
        return resolved, missing

    def _prepare_datasource_configs(self, ds_item: DatasourceItem, existing: DataSourceAPIModel | None = None):
        connection_config, missing_connection = self._resolve_config_placeholders(
            ds_item.key,
            "connection_config",
            ds_item.connection_config,
            existing.connection_config if existing else None,
        )
        query_config, missing_query = self._resolve_config_placeholders(
            ds_item.key,
            "query_config",
            ds_item.query_config,
            existing.query_config if existing else None,
        )
        return connection_config, query_config, missing_connection + missing_query

    def _reset_excel_materialization_if_needs_upload(self, existing: DataSourceAPIModel, query_config: dict) -> None:
        """新格式 Excel（无 imported_items）覆盖时清空旧槽，强制 needs_upload。"""
        imported = query_config.get("imported_items") if isinstance(query_config, dict) else None
        if isinstance(imported, list) and imported:
            return
        if existing.source_type != DataSourceAPIModel.SOURCE_TYPE_EXCEL:
            return

        from apps.operation_analysis.services.excel_materialize import abandon_excel_materialization

        abandon_excel_materialization(existing, clear_excel_query_keys=False)

    def _generate_rename_name(self, original_name: str, model) -> str:
        """
        生成重命名后的名称

        规则：{original_name}_copy，若仍冲突则继续追加_copy
        """
        name_max_length = model._meta.get_field("name").max_length
        max_suffixes = (name_max_length - len(original_name)) // len(RENAME_SUFFIX)
        candidates = [f"{original_name}{RENAME_SUFFIX * count}" for count in range(1, max_suffixes + 1)]
        existing_names = set(model.objects.filter(name__in=candidates).values_list("name", flat=True))

        for candidate in candidates:
            if candidate not in existing_names:
                return candidate

        raise ValueError(oa_message("messages.import_rename_exhausted", "名称 {name} 已无可用的重命名空间", name=original_name))

    def _record_result(
        self,
        object_key: str,
        object_type: str,
        status: str,
        message: str = "",
        new_id: int | None = None,
    ):
        """记录单个对象的导入结果"""
        self.results.append(
            {
                "object_key": object_key,
                "object_type": object_type,
                "status": status,
                "message": message,
                "new_id": new_id,
            }
        )

    def _has_failed_results(self) -> bool:
        return any(result["status"] == ImportStatus.FAILED.value for result in self.results)

    def _rollback_on_failure(self) -> dict | None:
        if not self._has_failed_results():
            return None

        transaction.set_rollback(True)
        summary = self._build_summary()
        logger.warning("[CanvasImport] 存在导入失败项，事务已回滚：%s", summary)
        return {
            "success": False,
            "results": self.results,
            "summary": summary,
        }

    def _import_namespace(self, ns_item: NamespaceItem) -> int | None:
        """
        导入单个命名空间

        Returns:
            新建或已存在的命名空间ID
        """
        existing = NameSpace.objects.filter(name=ns_item.name).first()
        action = self._get_conflict_action(ns_item.key, ObjectType.NAMESPACE)

        # 获取密码值（优先使用supplement，否则使用YAML中的值）
        password = self._get_secret_value(ns_item.key, "password")
        if not password or password == SENSITIVE_PLACEHOLDER:
            password = ns_item.password if ns_item.password != SENSITIVE_PLACEHOLDER else ""

        if existing:
            if action == ConflictAction.SKIP.value:
                self._record_result(
                    ns_item.key,
                    ObjectType.NAMESPACE.value,
                    ImportStatus.SKIPPED.value,
                    oa_message("messages.import_namespace_skipped", "跳过已存在的命名空间"),
                    existing.id,
                )
                return existing.id

            elif action == ConflictAction.OVERWRITE.value:
                # 全量覆盖
                existing.domain = ns_item.domain
                existing.namespace = ns_item.namespace
                existing.account = ns_item.account
                if password and password != SENSITIVE_PLACEHOLDER:
                    existing.set_password(password)
                existing.enable_tls = ns_item.enable_tls
                existing.desc = ns_item.desc
                existing.updated_by = self.updated_by
                existing.save()
                self._record_result(
                    ns_item.key,
                    ObjectType.NAMESPACE.value,
                    ImportStatus.OVERWRITTEN.value,
                    oa_message("messages.import_namespace_overwritten", "覆盖已存在的命名空间"),
                    existing.id,
                )
                return existing.id

            else:  # rename
                new_name = self._generate_rename_name(ns_item.name, NameSpace)
                ns = NameSpace(
                    name=new_name,
                    domain=ns_item.domain,
                    namespace=ns_item.namespace,
                    account=ns_item.account,
                    enable_tls=ns_item.enable_tls,
                    desc=ns_item.desc,
                    created_by=self.created_by,
                    updated_by=self.updated_by,
                )
                if password and password != SENSITIVE_PLACEHOLDER:
                    ns.set_password(password)
                ns.save()
                self._record_result(
                    ns_item.key,
                    ObjectType.NAMESPACE.value,
                    ImportStatus.SUCCESS.value,
                    oa_message("messages.import_renamed", "重命名为 {name}", name=new_name),
                    ns.id,
                )
                return ns.id
        else:
            # 新建
            if not password or password == SENSITIVE_PLACEHOLDER:
                self._record_result(
                    ns_item.key,
                    ObjectType.NAMESPACE.value,
                    ImportStatus.FAILED.value,
                    oa_message("messages.import_namespace_password_missing", "新建命名空间缺少密码"),
                )
                return None

            ns = NameSpace(
                name=ns_item.name,
                domain=ns_item.domain,
                namespace=ns_item.namespace,
                account=ns_item.account,
                enable_tls=ns_item.enable_tls,
                desc=ns_item.desc,
                created_by=self.created_by,
                updated_by=self.updated_by,
            )
            ns.set_password(password)
            ns.save()
            self._record_result(
                ns_item.key,
                ObjectType.NAMESPACE.value,
                ImportStatus.SUCCESS.value,
                oa_message("messages.import_namespace_created", "新建命名空间"),
                ns.id,
            )
            return ns.id

    def _import_datasource(self, ds_item: DatasourceItem) -> int | None:
        """
        导入单个数据源

        Returns:
            新建或已存在的数据源ID
        """
        existing = DataSourceAPIModel.objects.filter(name=ds_item.name, rest_api=ds_item.rest_api).first()
        if existing and self.datasource_resolve == DatasourceResolve.PREFER_EXISTING.value:
            self._record_result(
                ds_item.key,
                ObjectType.DATASOURCE.value,
                ImportStatus.SKIPPED.value,
                datasource_reused_message(),
                existing.id,
            )
            return existing.id
        action = self._get_conflict_action(ds_item.key, ObjectType.DATASOURCE)

        targets_legacy_route = is_legacy_raw_monitor_query(
            source_type=ds_item.source_type,
            rest_api=ds_item.rest_api,
        )
        if targets_legacy_route:
            self._record_result(
                ds_item.key,
                ObjectType.DATASOURCE.value,
                ImportStatus.FAILED.value,
                oa_message("messages.import_legacy_raw_monitor", LEGACY_RAW_MONITOR_QUERY_ERROR),
            )
            return None

        # 解析关联的命名空间ID
        namespace_ids = [self.namespace_key_to_id[ns_key] for ns_key in ds_item.namespace_keys if ns_key in self.namespace_key_to_id]

        # 解析tags
        tag_ids = [self.tag_name_to_id[tag_name] for tag_name in ds_item.tags if tag_name in self.tag_name_to_id]

        if existing:
            if action == ConflictAction.SKIP.value:
                self._record_result(
                    ds_item.key,
                    ObjectType.DATASOURCE.value,
                    ImportStatus.SKIPPED.value,
                    oa_message("messages.import_datasource_skipped", "跳过已存在的数据源"),
                    existing.id,
                )
                return existing.id

            elif action == ConflictAction.OVERWRITE.value:
                connection_config, query_config, missing_secrets = self._prepare_datasource_configs(ds_item, existing)
                if missing_secrets:
                    self._record_result(
                        ds_item.key,
                        ObjectType.DATASOURCE.value,
                        ImportStatus.FAILED.value,
                        oa_message(
                            "messages.import_datasource_secrets_missing",
                            "数据源缺少敏感配置: {fields}",
                            fields=", ".join(missing_secrets),
                        ),
                    )
                    return None
                previous_source_type = existing.source_type
                existing.desc = ds_item.desc
                existing.source_type = ds_item.source_type
                existing.connection = None
                existing.connection_overrides = {}
                existing.connection_config = connection_config
                existing.query_config = query_config
                existing.transform_config = self._normalize_transform_config(ds_item)
                # [内部预留] is_active 字段仅内部使用，无产品功能依赖
                existing.is_active = ds_item.is_active
                existing.params = migrate_param_items(ds_item.params)[0]
                existing.chart_type = ds_item.chart_type
                existing.field_schema = ds_item.field_schema
                existing.updated_by = self.updated_by
                existing.save()
                if previous_source_type == DataSourceAPIModel.SOURCE_TYPE_EXCEL and existing.source_type != DataSourceAPIModel.SOURCE_TYPE_EXCEL:
                    from apps.operation_analysis.services.excel_materialize import abandon_excel_materialization

                    abandon_excel_materialization(existing, clear_excel_query_keys=False)
                elif existing.source_type == DataSourceAPIModel.SOURCE_TYPE_EXCEL:
                    self._reset_excel_materialization_if_needs_upload(existing, query_config)
                existing.namespaces.set(namespace_ids)
                existing.tag.set(tag_ids)
                self._record_result(
                    ds_item.key,
                    ObjectType.DATASOURCE.value,
                    ImportStatus.OVERWRITTEN.value,
                    oa_message("messages.import_datasource_overwritten", "覆盖已存在的数据源"),
                    existing.id,
                )
                return existing.id

            else:  # rename
                connection_config, query_config, missing_secrets = self._prepare_datasource_configs(ds_item)
                if missing_secrets:
                    self._record_result(
                        ds_item.key,
                        ObjectType.DATASOURCE.value,
                        ImportStatus.FAILED.value,
                        oa_message(
                            "messages.import_datasource_secrets_missing",
                            "数据源缺少敏感配置: {fields}",
                            fields=", ".join(missing_secrets),
                        ),
                    )
                    return None
                new_name = self._generate_rename_name(ds_item.name, DataSourceAPIModel)
                ds = DataSourceAPIModel.objects.create(
                    name=new_name,
                    rest_api=ds_item.rest_api,
                    source_type=ds_item.source_type,
                    connection=None,
                    connection_overrides={},
                    connection_config=connection_config,
                    query_config=query_config,
                    transform_config=self._normalize_transform_config(ds_item),
                    desc=ds_item.desc,
                    # [内部预留] is_active 字段仅内部使用，无产品功能依赖
                    is_active=ds_item.is_active,
                    params=migrate_param_items(ds_item.params)[0],
                    chart_type=ds_item.chart_type,
                    field_schema=ds_item.field_schema,
                    created_by=self.created_by,
                    updated_by=self.updated_by,
                    groups=self.datasource_groups,
                )
                ds.namespaces.set(namespace_ids)
                ds.tag.set(tag_ids)
                self._record_result(
                    ds_item.key,
                    ObjectType.DATASOURCE.value,
                    ImportStatus.SUCCESS.value,
                    oa_message("messages.import_renamed", "重命名为 {name}", name=new_name),
                    ds.id,
                )
                return ds.id
        else:
            # 新建
            connection_config, query_config, missing_secrets = self._prepare_datasource_configs(ds_item)
            if missing_secrets:
                self._record_result(
                    ds_item.key,
                    ObjectType.DATASOURCE.value,
                    ImportStatus.FAILED.value,
                    oa_message(
                        "messages.import_datasource_secrets_missing",
                        "数据源缺少敏感配置: {fields}",
                        fields=", ".join(missing_secrets),
                    ),
                )
                return None
            ds = DataSourceAPIModel.objects.create(
                name=ds_item.name,
                rest_api=ds_item.rest_api,
                source_type=ds_item.source_type,
                connection=None,
                connection_overrides={},
                connection_config=connection_config,
                query_config=query_config,
                transform_config=self._normalize_transform_config(ds_item),
                desc=ds_item.desc,
                # [内部预留] is_active 字段仅内部使用，无产品功能依赖
                is_active=ds_item.is_active,
                params=migrate_param_items(ds_item.params)[0],
                chart_type=ds_item.chart_type,
                field_schema=ds_item.field_schema,
                created_by=self.created_by,
                updated_by=self.updated_by,
                groups=self.datasource_groups,
            )
            ds.namespaces.set(namespace_ids)
            ds.tag.set(tag_ids)
            self._record_result(
                ds_item.key,
                ObjectType.DATASOURCE.value,
                ImportStatus.SUCCESS.value,
                oa_message("messages.import_datasource_created", "新建数据源"),
                ds.id,
            )
            return ds.id

    def _locate_canvas(self, canvas_item, object_type: ObjectType, model):
        stable_existing_id = self.existing_canvas_ids.get((object_type.value, canvas_item.key))
        if stable_existing_id is not None:
            return model.objects.filter(pk=stable_existing_id).first(), "stable_id", stable_existing_id, None

        canvas_key = normalized_canvas_key(canvas_item) if supports_user_canvas_key(object_type) else ""
        if self.assign_user_canvas_key and canvas_key:
            existing = model.objects.filter(canvas_key=canvas_key).first()
            if existing is not None and existing.is_build_in:
                return None, "canvas_key", None, (ImportExportErrorCode.IMPORT_BUILTIN_PROTECTED, builtin_protected_message())
            if canvas_key in self._builtin_key_blocklist and existing is None:
                return None, "canvas_key", None, (ImportExportErrorCode.IMPORT_BUILTIN_KEY_REJECTED, builtin_key_rejected_message())
            return existing, "canvas_key", None, None

        return model.objects.filter(name=canvas_item.name).first(), "name", None, None

    def _directory_for_canvas(self, canvas_item, object_type: ObjectType):
        if supports_user_canvas_key(object_type) and self.use_directory_path:
            path = normalized_directory_path(canvas_item)
            if path:
                try:
                    return resolve_directory_path(path, **self._directory_visibility_kwargs()), None
                except DirectoryPathError as exc:
                    code = exc.code if exc.code in DIRECTORY_RESOLUTION_ERROR_CODES else ImportExportErrorCode.IMPORT_DIRECTORY_PATH_INVALID
                    return None, (code, directory_path_error_message(exc))
            if self.target_directory_id:
                directory = Directory.objects.filter(id=self.target_directory_id).first()
                if directory is None:
                    return None, (ImportExportErrorCode.IMPORT_DIRECTORY_MISSING, directory_missing_message())
                visible_error = ensure_directory_visible(directory, **self._directory_visibility_kwargs())
                if visible_error:
                    return None, visible_error
                return directory, None
            return None, (ImportExportErrorCode.IMPORT_DIRECTORY_PATH_REQUIRED, directory_path_required_message())

        directory = None
        if self.target_directory_id:
            directory = Directory.objects.filter(id=self.target_directory_id).first()
        return directory, None

    def _directory_visibility_kwargs(self) -> dict:
        return {
            "current_team": self.current_team,
            "enforce_visibility": self.enforce_directory_visibility,
            "is_superuser": self.directory_visibility_superuser,
        }

    def _fail_canvas(self, canvas_item, object_type: ObjectType, code: str, message: str) -> None:
        self._record_result(canvas_item.key, object_type.value, ImportStatus.FAILED.value, message)
        self.results[-1]["code"] = code

    def _stamp_new_canvas_key(self, canvas_data: dict, canvas_item, object_type: ObjectType, model, *, reuse_package_key: bool):
        if not self.assign_user_canvas_key or not supports_user_canvas_key(object_type):
            return None
        package_key = normalized_canvas_key(canvas_item)
        if reuse_package_key and package_key:
            holder = user_canvas_key_may_keep_reserved_key(model, package_key)
            if package_key in self._builtin_key_blocklist and holder is None:
                return ImportExportErrorCode.IMPORT_BUILTIN_KEY_REJECTED, builtin_key_rejected_message()
            canvas_data["canvas_key"] = package_key
            return None
        canvas_data["canvas_key"] = allocate_canvas_key(model, object_type)
        return None

    def _fail_duplicate_canvas_keys(self) -> bool:
        seen = set()
        duplicated = False
        for object_type, items in (
            (ObjectType.DASHBOARD, self.doc.dashboards),
            (ObjectType.SCREEN, self.doc.screens),
        ):
            for item in items:
                canvas_key = normalized_canvas_key(item)
                if not canvas_key or canvas_key not in seen:
                    if canvas_key:
                        seen.add(canvas_key)
                    continue
                duplicated = True
                self._fail_canvas(
                    item,
                    object_type,
                    ImportExportErrorCode.IMPORT_CANVAS_KEY_DUPLICATED,
                    duplicated_canvas_key_message(canvas_key),
                )
        return duplicated

    @staticmethod
    def _group_identity(groups) -> set:
        identity = set()
        for group_id in groups or []:
            try:
                identity.add(int(group_id))
            except (TypeError, ValueError):
                identity.add(group_id)
        return identity

    def _inherit_directory_groups(self) -> bool:
        """key_overwrite 的新数据源跟随画布目录组织。跨组织的包直接失败，不把组织并成一份。"""
        if not self.inherit_directory_groups:
            return False
        chosen: list | None = None
        chosen_identity: set | None = None
        for object_type, items in (
            (ObjectType.DASHBOARD, self.doc.dashboards),
            (ObjectType.SCREEN, self.doc.screens),
        ):
            for item in items:
                directory, error = self._directory_for_canvas(item, object_type)
                if error or directory is None:
                    continue
                identity = self._group_identity(directory.groups)
                if chosen is None:
                    chosen = list(directory.groups or [])
                    chosen_identity = identity
                    continue
                if identity != chosen_identity:
                    self._fail_canvas(
                        item,
                        object_type,
                        ImportExportErrorCode.IMPORT_PACKAGE_ORG_DIVERGED,
                        package_org_diverged_message(),
                    )
                    return True
        if chosen is not None:
            self.datasource_groups = chosen
        return False

    def _store_canvas(self, canvas_item, object_type: ObjectType, model, canvas_data: dict, existing, status: str, message: str):
        saved, persist_error = self._persist_canvas(model, canvas_data, existing)
        if persist_error:
            self._fail_canvas(canvas_item, object_type, persist_error[0], persist_error[1])
            return None
        self._record_result(canvas_item.key, object_type.value, status, message, saved.id)
        return saved.id

    def _persist_canvas(self, model, canvas_data: dict, existing=None):
        try:
            with transaction.atomic():
                if existing is None:
                    return model.objects.create(**canvas_data), None
                for key, value in canvas_data.items():
                    setattr(existing, key, value)
                existing.updated_by = self.updated_by
                existing.save()
                return existing, None
        except IntegrityError as exc:
            detail = str(exc).lower()
            if "canvas_key" in detail:
                return None, (ImportExportErrorCode.IMPORT_CANVAS_KEY_TAKEN, canvas_key_taken_message())
            if "name" in detail:
                return None, (ImportExportErrorCode.IMPORT_CANVAS_NAME_TAKEN, canvas_name_taken_message(canvas_data.get("name", "")))
            raise

    def _bind_undeclared_datasources(self) -> None:
        if self.datasource_resolve != DatasourceResolve.PREFER_EXISTING.value:
            return
        sections = (
            (self.doc.dashboards, ObjectType.DASHBOARD),
            (self.doc.topologies, ObjectType.TOPOLOGY),
            (self.doc.architectures, ObjectType.ARCHITECTURE),
            (self.doc.screens, ObjectType.SCREEN),
            (self.doc.reports, ObjectType.REPORT),
            (self.doc.network_topologies, ObjectType.NETWORK_TOPOLOGY),
        )
        for items, object_type in sections:
            for canvas in items:
                for ds_key in canvas.refs.datasource_keys:
                    if ds_key in self.datasource_key_to_id:
                        continue
                    existing = find_existing_datasource_by_key(ds_key)
                    if existing is not None:
                        self.datasource_key_to_id[ds_key] = existing.id
                        continue
                    self._fail_canvas(
                        canvas,
                        object_type,
                        ImportExportErrorCode.IMPORT_DEPENDENCY_MISSING,
                        canvas_datasource_missing_target_message(object_type.value, canvas.name, ds_key),
                    )

    def _import_canvas(
        self,
        canvas_item: DashboardItem | TopologyItem | ArchitectureItem | ScreenItem | ReportItem | NetworkTopologyItem,
        object_type: ObjectType,
        model,
    ) -> int | None:
        """
        导入单个画布对象

        Returns:
            新建或已存在的画布ID
        """
        existing, matched_by, stable_existing_id, locate_error = self._locate_canvas(canvas_item, object_type, model)
        if locate_error:
            self._fail_canvas(canvas_item, object_type, locate_error[0], locate_error[1])
            return None
        action = self._get_conflict_action(canvas_item.key, object_type)
        if (
            self.assign_user_canvas_key
            and matched_by != "stable_id"
            and existing is not None
            and existing.is_build_in
            and action == ConflictAction.OVERWRITE.value
        ):
            self._fail_canvas(canvas_item, object_type, ImportExportErrorCode.IMPORT_BUILTIN_PROTECTED, builtin_protected_message())
            return None

        directory, directory_error = self._directory_for_canvas(canvas_item, object_type)
        if directory_error:
            self._fail_canvas(canvas_item, object_type, directory_error[0], directory_error[1])
            return None

        canvas_groups = directory.groups if directory is not None else self.groups

        # 构建基础数据
        canvas_data = {
            "desc": canvas_item.desc,
            "view_sets": rewrite_canvas_view_sets_refs_for_storage(
                canvas_item.view_sets,
                object_type,
                self.datasource_key_to_id,
            ),
            "directory": directory,
        }
        if existing is None or not (stable_existing_id is not None and self.preserve_existing_canvas_groups):
            canvas_data["groups"] = canvas_groups

        if stable_existing_id is not None:
            name_conflict = model.objects.filter(name=canvas_item.name).exclude(pk=stable_existing_id).exists()
            if name_conflict:
                logger.warning(
                    "[CanvasImport] 内置%s稳定键 %s 的目标名称 %s 已被占用，保留原名称",
                    object_type.value,
                    canvas_item.key,
                    canvas_item.name,
                )
            else:
                canvas_data["name"] = canvas_item.name

        if object_type == ObjectType.NETWORK_TOPOLOGY:
            canvas_data["base_url"] = canvas_item.base_url
            token = self._get_secret_value(canvas_item.key, "token")
            if not token and canvas_item.token != SENSITIVE_PLACEHOLDER:
                token = canvas_item.token
            if token and token != SENSITIVE_PLACEHOLDER:
                canvas_data["token"] = token
        else:
            canvas_data["other"] = canvas_item.other

        # Dashboard有额外的filters字段
        if object_type == ObjectType.DASHBOARD and hasattr(canvas_item, "filters"):
            canvas_data["filters"] = migrate_filters_payload(canvas_item.filters)[0]

        if object_type in CANVAS_REFRESH_OBJECT_TYPES:
            canvas_data["refresh_interval"] = normalize_canvas_refresh_interval(getattr(canvas_item, "refresh_interval", 0))

        if existing:
            if action == ConflictAction.SKIP.value:
                self._record_result(
                    canvas_item.key,
                    object_type.value,
                    ImportStatus.SKIPPED.value,
                    oa_message("messages.import_canvas_skipped", "跳过已存在的{object_type}", object_type=object_type.value),
                    existing.id,
                )
                return existing.id

            elif action == ConflictAction.OVERWRITE.value:
                if matched_by == "canvas_key":
                    if model.objects.filter(name=canvas_item.name).exclude(pk=existing.pk).exists():
                        self._fail_canvas(
                            canvas_item,
                            object_type,
                            ImportExportErrorCode.IMPORT_CANVAS_NAME_TAKEN,
                            canvas_name_taken_message(canvas_item.name),
                        )
                        return None
                    canvas_data["name"] = canvas_item.name
                if matched_by == "canvas_key" or (matched_by == "name" and not (existing.canvas_key or "").strip()):
                    key_error = self._stamp_new_canvas_key(
                        canvas_data,
                        canvas_item,
                        object_type,
                        model,
                        reuse_package_key=matched_by == "canvas_key",
                    )
                    if key_error:
                        self._fail_canvas(canvas_item, object_type, key_error[0], key_error[1])
                        return None
                return self._store_canvas(
                    canvas_item,
                    object_type,
                    model,
                    canvas_data,
                    existing,
                    ImportStatus.OVERWRITTEN.value,
                    oa_message("messages.import_canvas_overwritten", "覆盖已存在的{object_type}", object_type=object_type.value),
                )

            else:  # rename
                new_name = self._generate_rename_name(canvas_item.name, model)
                canvas_data["name"] = new_name
                canvas_data["created_by"] = self.created_by
                canvas_data["updated_by"] = self.updated_by
                key_error = self._stamp_new_canvas_key(
                    canvas_data,
                    canvas_item,
                    object_type,
                    model,
                    reuse_package_key=False,
                )
                if key_error:
                    self._fail_canvas(canvas_item, object_type, key_error[0], key_error[1])
                    return None
                return self._store_canvas(
                    canvas_item,
                    object_type,
                    model,
                    canvas_data,
                    None,
                    ImportStatus.SUCCESS.value,
                    oa_message("messages.import_renamed", "重命名为 {name}", name=new_name),
                )
        else:
            # 新建
            canvas_data["name"] = canvas_item.name
            canvas_data["created_by"] = self.created_by
            canvas_data["updated_by"] = self.updated_by
            if self.assign_user_canvas_key and model.objects.filter(name=canvas_data["name"]).exists():
                if action == ConflictAction.RENAME.value:
                    canvas_data["name"] = self._generate_rename_name(canvas_item.name, model)
                else:
                    self._fail_canvas(
                        canvas_item,
                        object_type,
                        ImportExportErrorCode.IMPORT_CANVAS_NAME_TAKEN,
                        canvas_name_taken_message(canvas_item.name),
                    )
                    return None
            key_error = self._stamp_new_canvas_key(
                canvas_data,
                canvas_item,
                object_type,
                model,
                reuse_package_key=True,
            )
            if key_error:
                self._fail_canvas(canvas_item, object_type, key_error[0], key_error[1])
                return None
            return self._store_canvas(
                canvas_item,
                object_type,
                model,
                canvas_data,
                None,
                ImportStatus.SUCCESS.value,
                oa_message("messages.import_canvas_created", "新建{object_type}", object_type=object_type.value),
            )

    @transaction.atomic
    def execute(self) -> dict:
        """
        执行导入

        按依赖顺序导入：namespace -> datasource -> canvas
        整个过程在事务中执行，任一失败则回滚。

        Returns:
            {
                "success": bool,
                "results": [...],
                "summary": {
                    "total": int,
                    "success": int,
                    "failed": int,
                    "skipped": int,
                    "overwritten": int
                }
            }
        """
        package_keys = [
            normalized_canvas_key(item) for item in (*self.doc.dashboards, *self.doc.screens) if normalized_canvas_key(item)
        ]
        self._builtin_key_blocklist = canvas_keys_occupied_by_builtin(package_keys)
        if self._fail_duplicate_canvas_keys():
            return self._rollback_on_failure()
        if self._inherit_directory_groups():
            return self._rollback_on_failure()

        logger.info(
            "[CanvasImport] 开始导入：命名空间 %s、数据源 %s、仪表盘 %s、拓扑 %s、架构 %s、大屏 %s、报表 %s、网络拓扑 %s",
            len(self.doc.namespaces),
            len(self.doc.datasources),
            len(self.doc.dashboards),
            len(self.doc.topologies),
            len(self.doc.architectures),
            len(self.doc.screens),
            len(self.doc.reports),
            len(self.doc.network_topologies),
        )

        try:
            # Step 1: 导入命名空间
            for ns_item in self.doc.namespaces:
                ns_id = self._import_namespace(ns_item)
                if ns_id:
                    self.namespace_key_to_id[ns_item.key] = ns_id

            rollback_result = self._rollback_on_failure()
            if rollback_result:
                return rollback_result

            # Step 2: 导入数据源
            namespace_keys = {
                ns_key for ds_item in self.doc.datasources for ns_key in ds_item.namespace_keys if ns_key not in self.namespace_key_to_id
            }
            self.namespace_key_to_id.update(NameSpace.objects.filter(name__in=namespace_keys).values_list("name", "id"))
            tag_names = {tag_name for ds_item in self.doc.datasources for tag_name in ds_item.tags}
            self.tag_name_to_id.update(DataSourceTag.objects.filter(name__in=tag_names).values_list("name", "id"))
            for ds_item in self.doc.datasources:
                ds_id = self._import_datasource(ds_item)
                if ds_id:
                    self.datasource_key_to_id[ds_item.key] = ds_id

            rollback_result = self._rollback_on_failure()
            if rollback_result:
                return rollback_result

            self._bind_undeclared_datasources()
            rollback_result = self._rollback_on_failure()
            if rollback_result:
                return rollback_result

            # Step 3: 导入画布对象
            for dashboard in self.doc.dashboards:
                self._import_canvas(dashboard, ObjectType.DASHBOARD, Dashboard)

            for topology in self.doc.topologies:
                self._import_canvas(topology, ObjectType.TOPOLOGY, Topology)

            for architecture in self.doc.architectures:
                self._import_canvas(architecture, ObjectType.ARCHITECTURE, Architecture)

            for screen in self.doc.screens:
                self._import_canvas(screen, ObjectType.SCREEN, Screen)

            for report in self.doc.reports:
                self._import_canvas(report, ObjectType.REPORT, Report)

            for network_topology in self.doc.network_topologies:
                self._import_canvas(network_topology, ObjectType.NETWORK_TOPOLOGY, NetworkTopology)

            rollback_result = self._rollback_on_failure()
            if rollback_result:
                return rollback_result

            # 统计结果
            summary = self._build_summary()

            logger.info("[CanvasImport] 导入完成：%s", summary)

            return {
                "success": summary["failed"] == 0,
                "results": self.results,
                "summary": summary,
            }

        except Exception as e:
            logger.error("[CanvasImport] 导入过程异常中断：%s", e, exc_info=True)
            raise

    def _build_summary(self) -> dict:
        """构建导入结果统计"""
        summary = {
            "total": len(self.results),
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "overwritten": 0,
        }

        for result in self.results:
            status = result["status"]
            if status == ImportStatus.SUCCESS.value:
                summary["success"] += 1
            elif status == ImportStatus.FAILED.value:
                summary["failed"] += 1
            elif status == ImportStatus.SKIPPED.value:
                summary["skipped"] += 1
            elif status == ImportStatus.OVERWRITTEN.value:
                summary["overwritten"] += 1

        return summary
