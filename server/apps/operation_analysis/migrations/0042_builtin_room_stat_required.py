from django.db import migrations

# 只给三份内置机房统计源的 server_room_id 补 required。
# 不改其它参数，不改机房列表，也不改用户自建数据源。
_ROOM_STAT_REST_APIS = frozenset(
    {
        "cmdb/get_room_device_type_distribution",
        "cmdb/get_room_rack_capacity",
        "cmdb/get_room_active_alarms",
    }
)
_TARGET_PARAM = "server_room_id"


def _mark_server_room_required(params):
    if not isinstance(params, list):
        return params, False
    changed = False
    next_params = []
    for param in params:
        if not isinstance(param, dict) or param.get("name") != _TARGET_PARAM:
            next_params.append(param)
            continue
        if param.get("required") is True:
            next_params.append(param)
            continue
        updated = dict(param)
        updated["required"] = True
        next_params.append(updated)
        changed = True
    return next_params, changed


def mark_builtin_room_stat_server_room_required(apps, _schema_editor):
    model = apps.get_model("operation_analysis", "DataSourceAPIModel")
    rows = model.objects.filter(
        is_build_in=True,
        rest_api__in=sorted(_ROOM_STAT_REST_APIS),
    )
    for row in rows.iterator():
        next_params, changed = _mark_server_room_required(row.params)
        if not changed:
            continue
        row.params = next_params
        row.save(update_fields=["params"])


def keep_builtin_room_stat_required(_apps, _schema_editor):
    # 正向不记录改前是否已有 required。已部署的库无法把 true 拆回「迁移写入」和「原本就有」，
    # 逆向删除会把用户或种子里原来的 true 一起拿掉，所以逆向保持现状。
    return None


class Migration(migrations.Migration):
    dependencies = [
        ("operation_analysis", "0041_datasource_portable_key"),
    ]

    operations = [
        migrations.RunPython(
            mark_builtin_room_stat_server_room_required,
            keep_builtin_room_stat_required,
        ),
    ]
