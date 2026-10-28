# -- coding: utf-8 --
"""按 YAML 权威交付仪表盘/大屏。

调用与页面导入相同的 PrecheckService / ImportService，不另建一套 schema。
默认 conflict_policy=key_overwrite、datasource_resolve=prefer_existing。
目录优先读 YAML directory_path；路径缺失时用 --directory。不会补建缺失目录。
组织跟随解析到的目录，不读取包内组织 id。
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.operation_analysis.models.models import Directory
from apps.operation_analysis.services.import_export.canvas_authority import ConflictPolicy, DatasourceResolve, import_call_options
from apps.operation_analysis.services.import_export.import_service import ImportService
from apps.operation_analysis.services.import_export.precheck_service import PrecheckService


class Command(BaseCommand):
    help = "应用仪表盘/大屏 YAML。默认按 canvas_key 覆盖，并复用目标环境已有数据源。"

    def add_arguments(self, parser):
        parser.add_argument("--file", required=True, help="YAML 文件路径")
        parser.add_argument(
            "--policy",
            default=ConflictPolicy.KEY_OVERWRITE.value,
            choices=[item.value for item in ConflictPolicy],
            help="整包冲突策略，默认 key_overwrite",
        )
        parser.add_argument("--directory", type=int, default=None, help="画布没有 directory_path 时的目标目录 ID")
        parser.add_argument(
            "--datasource-resolve",
            default=DatasourceResolve.PREFER_EXISTING.value,
            choices=[item.value for item in DatasourceResolve],
            help="数据源解析，默认 prefer_existing",
        )
        parser.add_argument("--operator", default="system", help="写入 created_by / updated_by 的操作者")

    def handle(self, *args, **options):
        yaml_path = Path(options["file"])
        if not yaml_path.is_file():
            raise CommandError("YAML 文件不存在")
        try:
            yaml_content = yaml_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise CommandError("YAML 文件无法读取") from exc

        directory_id = options["directory"]
        directory_groups = []
        if directory_id is not None:
            directory = Directory.objects.filter(id=directory_id).first()
            if directory is None:
                raise CommandError("目标目录不存在")
            directory_groups = list(directory.groups or [])

        call_options = import_call_options(
            {
                "target_directory_id": directory_id,
                "conflict_policy": options["policy"],
                "datasource_resolve": options["datasource_resolve"],
            }
        )
        precheck = PrecheckService.precheck(
            yaml_content=yaml_content,
            target_directory_id=call_options["target_directory_id"],
            conflict_policy=call_options["conflict_policy"],
            datasource_resolve=call_options["datasource_resolve"],
        )
        doc = precheck.pop("_doc", None)
        if not precheck["valid"] or doc is None:
            raise CommandError(self._format_failures("预检失败", precheck.get("errors") or []))

        operator = options["operator"] or "system"
        result = ImportService(
            doc=doc,
            target_directory_id=call_options["target_directory_id"],
            conflict_decisions={},
            secret_supplements={},
            created_by=operator,
            updated_by=operator,
            groups=directory_groups,
            conflict_policy=call_options["conflict_policy"],
            datasource_resolve=call_options["datasource_resolve"],
            use_directory_path=call_options["use_directory_path"],
            inherit_directory_groups=call_options["conflict_policy"] == ConflictPolicy.KEY_OVERWRITE.value,
        ).execute()

        summary = result.get("summary") or {}
        if not result.get("success"):
            failed = [item for item in result.get("results") or [] if item.get("status") == "failed"]
            raise CommandError(self._format_failures("导入失败", failed, summary))

        self.stdout.write(
            "apply_canvas_yaml success total={total} success={success} overwritten={overwritten} skipped={skipped}".format(
                total=summary.get("total", 0),
                success=summary.get("success", 0),
                overwritten=summary.get("overwritten", 0),
                skipped=summary.get("skipped", 0),
            )
        )

    @staticmethod
    def _format_failures(title, items, summary=None):
        parts = [title]
        if summary:
            parts.append(
                "total={total} failed={failed}".format(
                    total=summary.get("total", 0),
                    failed=summary.get("failed", 0),
                )
            )
        for item in items:
            code = item.get("code") or item.get("status") or "failed"
            object_key = item.get("object_key") or ""
            message = item.get("message") or ""
            parts.append(f"{code} {object_key} {message}".strip())
        return "; ".join(parts)
