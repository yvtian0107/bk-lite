# -- coding: utf-8 --
from rest_framework import serializers

from apps.operation_analysis.constants.import_export import CANVAS_TYPES, CONFIG_TYPES, ConflictAction, ObjectType, ScopeType
from apps.operation_analysis.services.import_export.canvas_authority import ConflictPolicy, DatasourceResolve
from apps.operation_analysis.services.user_messages import oa_message


class ExportRequestSerializer(serializers.Serializer):
    MAX_OBJECT_IDS = 1000

    object_type = serializers.ChoiceField(
        choices=[t.value for t in ObjectType],
        help_text="对象类型",
    )
    object_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        min_length=1,
        max_length=MAX_OBJECT_IDS,
        help_text="要导出的对象ID列表",
    )

    def validate(self, attrs):
        object_type = attrs["object_type"]

        if object_type in [t.value for t in CANVAS_TYPES]:
            attrs["scope"] = ScopeType.CANVAS.value
        elif object_type in [t.value for t in CONFIG_TYPES]:
            attrs["scope"] = ScopeType.CONFIG.value
        else:
            raise serializers.ValidationError(oa_message("messages.object_type_not_exportable", "object_type不支持导出"))

        return attrs


class ImportPrecheckRequestSerializer(serializers.Serializer):
    yaml_content = serializers.CharField(
        help_text="YAML文件内容",
    )
    target_directory_id = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="画布对象目标目录ID。页面导入画布时必填；key_overwrite 在 YAML 含 directory_path 时可以不填",
    )
    conflict_policy = serializers.ChoiceField(
        choices=[item.value for item in ConflictPolicy],
        required=False,
        allow_null=True,
        help_text="整包冲突策略。省略时沿用逐对象 skip/overwrite/rename，缺省动作为 rename。key_overwrite 按 canvas_key 覆盖仪表盘/大屏，供无人值守交付；页面导入不必传",
    )
    datasource_resolve = serializers.ChoiceField(
        choices=[item.value for item in DatasourceResolve],
        required=False,
        allow_null=True,
        help_text="数据源解析。prefer_existing：目标已有则复用且不覆盖源定义，没有再用包内定义。省略且 conflict_policy=key_overwrite 时默认 prefer_existing；页面导入省略时仍按冲突决策处理数据源",
    )

    def validate_yaml_content(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError(oa_message("messages.yaml_empty", "YAML内容不能为空"))
        return value


class ConflictDecisionSerializer(serializers.Serializer):
    object_key = serializers.CharField(help_text="对象业务键")
    action = serializers.ChoiceField(
        choices=[a.value for a in ConflictAction],
        help_text="冲突处理策略",
    )


class SecretSupplementSerializer(serializers.Serializer):
    object_key = serializers.CharField(help_text="对象业务键")
    field = serializers.CharField(help_text="敏感字段名")
    value = serializers.CharField(help_text="敏感字段值")


class ImportSubmitRequestSerializer(serializers.Serializer):
    yaml_content = serializers.CharField(
        help_text="YAML文件内容（与precheck相同）",
    )
    target_directory_id = serializers.IntegerField(
        required=False,
        allow_null=True,
        help_text="画布对象目标目录ID。页面导入以该目录为准，忽略 YAML directory_path；key_overwrite 仅在对应画布没有 directory_path 时使用",
    )
    conflict_policy = serializers.ChoiceField(
        choices=[item.value for item in ConflictPolicy],
        required=False,
        allow_null=True,
        help_text="整包冲突策略。key_overwrite 按稳定键覆盖仪表盘/大屏。显式 conflict_decisions 优先于该策略",
    )
    datasource_resolve = serializers.ChoiceField(
        choices=[item.value for item in DatasourceResolve],
        required=False,
        allow_null=True,
        help_text="数据源解析。prefer_existing 复用目标已有数据源且不覆盖其定义；package 按冲突决策写入包内定义。key_overwrite 未传时默认 prefer_existing",
    )
    conflict_decisions = serializers.ListField(
        child=ConflictDecisionSerializer(),
        required=False,
        default=list,
        help_text="冲突决策列表",
    )
    secret_supplements = serializers.ListField(
        child=SecretSupplementSerializer(),
        required=False,
        default=list,
        help_text="敏感字段补充列表",
    )

    def validate_yaml_content(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError(oa_message("messages.yaml_empty", "YAML内容不能为空"))
        return value


class ConflictItemSerializer(serializers.Serializer):
    object_key = serializers.CharField()
    object_type = serializers.CharField()
    reason = serializers.CharField()
    suggested_actions = serializers.ListField(child=serializers.CharField())


class WarningItemSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    object_key = serializers.CharField(required=False)
    field = serializers.CharField(required=False)


class ErrorItemSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    details = serializers.DictField(required=False)


class ObjectCountsSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    by_type = serializers.DictField(child=serializers.IntegerField())


class PrecheckResponseSerializer(serializers.Serializer):
    valid = serializers.BooleanField()
    counts = ObjectCountsSerializer()
    conflicts = ConflictItemSerializer(many=True)
    warnings = WarningItemSerializer(many=True)
    errors = ErrorItemSerializer(many=True)


class ImportResultItemSerializer(serializers.Serializer):
    object_key = serializers.CharField()
    object_type = serializers.CharField()
    status = serializers.CharField()
    message = serializers.CharField()
    new_id = serializers.IntegerField(allow_null=True)


class ImportSummarySerializer(serializers.Serializer):
    total = serializers.IntegerField()
    success = serializers.IntegerField()
    failed = serializers.IntegerField()
    skipped = serializers.IntegerField()
    overwritten = serializers.IntegerField()


class ImportSubmitResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    results = ImportResultItemSerializer(many=True)
    summary = ImportSummarySerializer()


class ExportResponseSerializer(serializers.Serializer):
    yaml_content = serializers.CharField()
    summary = serializers.DictField()
