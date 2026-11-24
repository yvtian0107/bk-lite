import importlib


def _migration():
    return importlib.import_module("apps.operation_analysis.migrations.0042_builtin_room_stat_required")


class _SavedModel:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
        self.save_calls = []

    def save(self, update_fields=None):
        self.save_calls.append(tuple(update_fields or []))


class _QuerySet:
    def __init__(self, items):
        self._items = items

    def filter(self, **kwargs):
        rest_apis = set(kwargs.get("rest_api__in") or [])
        builtin = kwargs.get("is_build_in")
        matched = [item for item in self._items if (not rest_apis or item.rest_api in rest_apis) and (builtin is None or item.is_build_in is builtin)]
        return _QuerySet(matched)

    def iterator(self):
        return iter(self._items)


class _Model:
    def __init__(self, items):
        self._items = items
        self.objects = self

    def filter(self, **kwargs):
        return _QuerySet(self._items).filter(**kwargs)


class _Apps:
    def __init__(self, items):
        self._items = items

    def get_model(self, app_label, model_name):
        assert app_label == "operation_analysis"
        assert model_name == "DataSourceAPIModel"
        return _Model(self._items)


def _room_params(**extra):
    return {
        "name": "server_room_id",
        "type": "string",
        "value": "",
        "alias_name": "机房",
        "filterType": "filter",
        "inputConfig": {"control": "select"},
        **extra,
    }


def test_marks_only_builtin_room_stat_server_room_and_is_idempotent():
    migration = _migration()
    device = _SavedModel(
        is_build_in=True,
        rest_api="cmdb/get_room_device_type_distribution",
        params=[_room_params(), {"name": "unused", "value": "keep", "alias_name": "保留"}],
    )
    rack = _SavedModel(
        is_build_in=True,
        rest_api="cmdb/get_room_rack_capacity",
        params=[
            _room_params(),
            {"name": "view", "value": "summary", "alias_name": "视图", "required": False},
            {"name": "limit", "value": 5, "alias_name": "返回条数"},
        ],
    )
    alarms = _SavedModel(
        is_build_in=True,
        rest_api="cmdb/get_room_active_alarms",
        params=[_room_params(required=True), {"name": "view", "value": "coverage"}],
    )
    room_list = _SavedModel(
        is_build_in=True,
        rest_api="cmdb/get_room_list",
        params=[],
    )
    custom = _SavedModel(
        is_build_in=False,
        rest_api="cmdb/get_room_device_type_distribution",
        params=[_room_params(desc="用户改过")],
    )
    apps = _Apps([device, rack, alarms, room_list, custom])

    migration.mark_builtin_room_stat_server_room_required(apps, None)

    assert device.params[0]["required"] is True
    assert device.params[0]["inputConfig"] == {"control": "select"}
    assert device.params[1] == {"name": "unused", "value": "keep", "alias_name": "保留"}
    assert device.save_calls == [("params",)]
    assert rack.params[0]["required"] is True
    assert rack.params[1]["required"] is False
    assert rack.params[2]["value"] == 5
    assert alarms.save_calls == []
    assert alarms.params[0]["required"] is True
    assert room_list.save_calls == []
    assert room_list.params == []
    assert custom.save_calls == []
    assert "required" not in custom.params[0]

    migration.mark_builtin_room_stat_server_room_required(apps, None)
    assert device.save_calls == [("params",)]
    assert rack.save_calls == [("params",)]
