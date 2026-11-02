import copy

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.logger import operation_analysis_logger as logger
from apps.operation_analysis.common.demo_source import ACCEPTANCE_DATASOURCE_SPECS, DEFAULT_NAMESPACE_NAME
from apps.operation_analysis.models.datasource_models import DataSourceAPIModel, DataSourceTag, NameSpace


def _default_group_ids():
    from apps.system_mgmt.models.user import Group

    default_group = Group.objects.filter(name="Default", parent_id=0).only("id").first()
    if default_group is None:
        return []
    return [default_group.id]


def _claim_existing(rest_api, name):
    matches = list(DataSourceAPIModel.objects.filter(rest_api=rest_api).order_by("id"))
    named = next((item for item in matches if item.name == name), None)
    if named is not None:
        return named
    if matches:
        return matches[0]
    return None


def _require_default_namespace():
    namespace = NameSpace.objects.filter(name=DEFAULT_NAMESPACE_NAME).order_by("id").first()
    if namespace is None:
        raise CommandError("未找到「默认命名空间」，请先执行 init_default_namespace")
    return namespace


def _require_tags(tag_ids):
    tags = list(DataSourceTag.objects.filter(tag_id__in=tag_ids))
    found = {tag.tag_id: tag for tag in tags}
    missing = [tag_id for tag_id in tag_ids if tag_id not in found]
    if missing:
        raise CommandError("未找到数据源标签: %s。请先执行 init_source_api_data" % ", ".join(missing))
    return [found[tag_id] for tag_id in tag_ids]


def upsert_acceptance_datasources(group_ids=None):
    """按 rest_api 幂等写入验收数据源。返回 (created_count, updated_count)。"""
    explicit_groups = group_ids is not None
    resolved_groups = list(group_ids) if explicit_groups else _default_group_ids()
    created_count = 0
    updated_count = 0
    needed_tag_ids = []
    for spec in ACCEPTANCE_DATASOURCE_SPECS:
        for tag_id in spec["tag_ids"]:
            if tag_id not in needed_tag_ids:
                needed_tag_ids.append(tag_id)

    with transaction.atomic():
        namespace = _require_default_namespace()
        tags_by_id = {tag.tag_id: tag for tag in _require_tags(needed_tag_ids)}
        for spec in ACCEPTANCE_DATASOURCE_SPECS:
            obj = _claim_existing(spec["rest_api"], spec["name"])
            created = obj is None
            if created:
                obj = DataSourceAPIModel(
                    name=spec["name"],
                    rest_api=spec["rest_api"],
                    created_by="system",
                    domain="domain.com",
                )
            obj.name = spec["name"]
            obj.rest_api = spec["rest_api"]
            obj.desc = spec["desc"]
            obj.source_type = DataSourceAPIModel.SOURCE_TYPE_NATS
            obj.params = copy.deepcopy(spec["params"])
            obj.chart_type = list(spec["chart_type"])
            obj.field_schema = copy.deepcopy(spec["field_schema"])
            obj.is_build_in = False
            obj.build_in_key = None
            obj.required_app = None
            obj.is_active = True
            obj.updated_by = "system"
            if created or explicit_groups:
                obj.groups = list(resolved_groups)
            elif not obj.groups and resolved_groups:
                obj.groups = list(resolved_groups)
            obj.save()
            obj.namespaces.set([namespace])
            obj.tag.set([tags_by_id[tag_id] for tag_id in spec["tag_ids"]])
            if created:
                created_count += 1
            else:
                updated_count += 1
            logger.debug("[AcceptCascadeSeed] 写入验收数据源 name=%s created=%s", spec["name"], created)

    logger.info(
        "[AcceptCascadeSeed] 验收数据源已就绪 created=%s updated=%s",
        created_count,
        updated_count,
    )
    return created_count, updated_count


class Command(BaseCommand):
    help = "幂等创建仅本地验收用的级联选项 mock 数据源（NATS，rest_api=demo/…，非内置）。可重复执行。"

    def add_arguments(self, parser):
        parser.add_argument(
            "--group-id",
            action="append",
            dest="group_ids",
            type=int,
            help="把数据源挂到该组织。可重复。省略时，空 groups 会补上名为 Default 的根组织（若存在）。",
        )

    def handle(self, *args, **options):
        group_ids = options.get("group_ids")
        created_count, updated_count = upsert_acceptance_datasources(group_ids)
        self.stdout.write(self.style.SUCCESS(f"验收数据源已就绪：新建 {created_count}，更新 {updated_count}。"))
        if group_ids:
            return
        rest_apis = [spec["rest_api"] for spec in ACCEPTANCE_DATASOURCE_SPECS]
        if any(not row.groups for row in DataSourceAPIModel.objects.filter(rest_api__in=rest_apis)):
            self.stdout.write(self.style.WARNING("有验收数据源 groups 仍为空，当前组织列表里看不到。可加 --group-id 指定组织。"))
