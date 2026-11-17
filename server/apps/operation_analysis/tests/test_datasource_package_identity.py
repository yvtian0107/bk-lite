"""跨环境数据源身份：句柄、两种冲突选择、旧包和事务。"""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import close_old_connections, transaction

from apps.operation_analysis.constants.import_export import YAML_SCHEMA_VERSION, ConflictAction, ConflictReason
from apps.operation_analysis.models.datasource_models import DataSourceAPIModel
from apps.operation_analysis.models.models import Dashboard
from apps.operation_analysis.schemas.import_export_schema import YAMLDocument
from apps.operation_analysis.services.import_export.import_service import ImportService
from apps.operation_analysis.services.import_export.precheck_service import PrecheckService

WINDOW_KEY = "window-identity"


def _doc(**sections):
    data = {"meta": {"schema_version": YAML_SCHEMA_VERSION}}
    data.update(sections)
    return YAMLDocument(**data)


def _days(value):
    return [{"name": "days", "type": "number", "value": value, "filterType": "fixed"}]


def _identity_section(*, days, key=f"portable::{WINDOW_KEY}", portable_key=WINDOW_KEY, name="时间窗口", rest_api="demo/window"):
    return {
        "key": key,
        "name": name,
        "rest_api": rest_api,
        "source_type": "nats",
        "desc": "",
        "params": _days(days),
        "identity": {"kind": "portable", "portable_key": portable_key},
    }


def _service(doc, decisions=None, **over):
    kwargs = dict(
        doc=doc,
        target_directory_id=None,
        conflict_decisions=decisions or {},
        secret_supplements={},
        created_by="tester",
        updated_by="tester",
        groups=[1],
    )
    kwargs.update(over)
    return ImportService(**kwargs)


def _window(**over):
    defaults = dict(
        name="时间窗口",
        rest_api="demo/window",
        source_type="nats",
        desc="",
        params=_days(7),
        portable_key=WINDOW_KEY,
        groups=[1],
        created_by="s",
        updated_by="s",
    )
    defaults.update(over)
    return DataSourceAPIModel.objects.create(**defaults)


@pytest.mark.django_db
def test_seven_day_target_can_be_reused_or_imported_as_new():
    target = _window()
    doc = _doc(
        datasources=[_identity_section(days=30)],
        dashboards=[
            {
                "key": "dashboard::窗口",
                "name": "窗口画布",
                "desc": "",
                "other": {},
                "filters": [
                    {
                        "id": "range",
                        "inputConfig": {
                            "optionsSource": {
                                "type": "dynamic",
                                "sourceRef": {"type": "rest_api", "value": f"portable::{WINDOW_KEY}"},
                            }
                        },
                    }
                ],
                "view_sets": [{"id": "w1", "valueConfig": {"dataSource": f"portable::{WINDOW_KEY}"}}],
            }
        ],
    )
    conflicts = PrecheckService.identify_conflicts(doc, current_team=1)
    assert len(conflicts) == 1
    assert conflicts[0]["reason"] == ConflictReason.IDENTITY_CONFIG_CONFLICT
    assert conflicts[0]["suggested_actions"] == [ConflictAction.REUSE_TARGET.value, ConflictAction.IMPORT_AS_NEW.value]
    assert "id" not in conflicts[0]
    assert target.name not in str(conflicts[0].get("message", ""))

    reused = _service(doc, {f"portable::{WINDOW_KEY}": ConflictAction.REUSE_TARGET.value}).execute()
    assert reused["success"] is True
    target.refresh_from_db()
    assert target.params[0]["value"] == 7
    dashboard = Dashboard.objects.get(name="窗口画布")
    assert dashboard.view_sets[0]["valueConfig"]["dataSource"] == target.id
    assert dashboard.filters[0]["inputConfig"]["optionsSource"]["sourceId"] == target.id
    assert DataSourceAPIModel.objects.count() == 1

    imported = _service(doc, {f"portable::{WINDOW_KEY}": ConflictAction.IMPORT_AS_NEW.value}).execute()
    assert imported["success"] is True
    target.refresh_from_db()
    assert target.params[0]["value"] == 7
    copies = DataSourceAPIModel.objects.exclude(pk=target.pk)
    assert copies.count() == 1
    copy = copies.get()
    assert copy.params[0]["value"] == 30
    assert copy.portable_key not in (None, "", WINDOW_KEY)
    assert copy.build_in_key in (None, "")
    assert copy.is_build_in is False
    new_dashboard = Dashboard.objects.exclude(pk=dashboard.pk).get()
    assert new_dashboard.view_sets[0]["valueConfig"]["dataSource"] == copy.id
    assert dashboard.view_sets[0]["valueConfig"]["dataSource"] == target.id


@pytest.mark.django_db
def test_repeat_import_of_same_identity_reuses_the_row():
    doc = _doc(datasources=[_identity_section(days=7)])
    assert PrecheckService.identify_conflicts(doc, current_team=1) == []
    first = _service(doc).execute()
    second = _service(doc).execute()
    assert first["success"] is True
    assert second["success"] is True
    assert DataSourceAPIModel.objects.count() == 1


@pytest.mark.django_db
def test_old_package_without_identity_does_not_attach_by_name():
    existing = DataSourceAPIModel.objects.create(
        name="ds-a",
        rest_api="monitor/query",
        desc="保持不动",
        created_by="s",
        updated_by="s",
        groups=[1],
    )
    section = {
        "key": "ds-a::monitor/query",
        "name": "ds-a",
        "rest_api": "monitor/query",
        "desc": "包里的新描述",
        "params": [],
    }
    doc = _doc(datasources=[section])
    conflicts = PrecheckService.identify_conflicts(doc, current_team=1)
    assert conflicts[0]["reason"] == ConflictReason.NAME_CONFLICT
    assert conflicts[0]["suggested_actions"] == [ConflictAction.RENAME.value]

    skipped = _service(doc, {"ds-a::monitor/query": ConflictAction.SKIP.value}).execute()
    assert skipped["summary"]["skipped"] == 1
    assert skipped["results"][0].get("new_id") is None
    existing.refresh_from_db()
    assert existing.desc == "保持不动"

    overwritten = _service(doc, {"ds-a::monitor/query": ConflictAction.OVERWRITE.value}).execute()
    assert overwritten["success"] is False
    existing.refresh_from_db()
    assert existing.desc == "保持不动"

    renamed = _service(doc, {"ds-a::monitor/query": ConflictAction.RENAME.value}).execute()
    assert renamed["success"] is True
    assert DataSourceAPIModel.objects.filter(name="ds-a_copy").exists()
    again = _service(doc, {"ds-a::monitor/query": ConflictAction.RENAME.value}).execute()
    assert again["success"] is True
    assert DataSourceAPIModel.objects.filter(name="ds-a").get().desc == "保持不动"
    assert DataSourceAPIModel.objects.exclude(pk=existing.pk).count() == 2


@pytest.mark.django_db
def test_cross_database_id_does_not_bind_the_local_row():
    decoy = DataSourceAPIModel.objects.create(name="本地占位", rest_api="demo/decoy", created_by="s", updated_by="s", groups=[1])
    doc = _doc(
        datasources=[_identity_section(days=7)],
        dashboards=[
            {
                "key": "dashboard::异库",
                "name": "异库画布",
                "desc": "",
                "other": {},
                "filters": [],
                "view_sets": [{"id": "w1", "valueConfig": {"dataSource": f"portable::{WINDOW_KEY}", "dataSourceParams": []}}],
            }
        ],
    )
    result = _service(doc).execute()
    assert result["success"] is True
    created = DataSourceAPIModel.objects.exclude(pk=decoy.pk).get()
    dashboard = Dashboard.objects.get(name="异库画布")
    assert dashboard.view_sets[0]["valueConfig"]["dataSource"] == created.id
    assert dashboard.view_sets[0]["valueConfig"]["dataSource"] != decoy.id


@pytest.mark.django_db
def test_missing_dependency_rolls_back_the_new_datasource():
    doc = _doc(
        datasources=[_identity_section(days=7)],
        dashboards=[
            {
                "key": "dashboard::缺依赖",
                "name": "缺依赖画布",
                "desc": "",
                "other": {},
                "filters": [],
                "view_sets": [{"id": "w1", "valueConfig": {"dataSource": "portable::does-not-exist"}}],
            }
        ],
    )
    result = _service(doc).execute()
    assert result["success"] is False
    assert DataSourceAPIModel.objects.count() == 0
    assert Dashboard.objects.count() == 0


@pytest.mark.django_db
def test_reuse_does_not_rewrite_nested_refs_on_the_target():
    child = DataSourceAPIModel.objects.create(
        name="子源",
        rest_api="demo/child",
        portable_key="child-key",
        params=[],
        created_by="s",
        updated_by="s",
        groups=[1],
    )
    parent_params = [
        {
            "name": "option",
            "type": "string",
            "filterType": "fixed",
            "inputConfig": {"optionsSource": {"type": "dynamic", "sourceId": child.id, "sourceSnapshot": {"name": "子源", "restApi": "demo/child"}}},
        }
    ]
    parent = _window(name="父源", rest_api="demo/parent", portable_key="parent-key", params=parent_params)
    package_params = [
        {
            "name": "option",
            "type": "string",
            "filterType": "fixed",
            "value": "changed",
            "inputConfig": {
                "optionsSource": {
                    "type": "dynamic",
                    "sourceRef": {"type": "rest_api", "value": "portable::some-other-child"},
                }
            },
        }
    ]
    doc = _doc(
        datasources=[
            {
                "key": "portable::parent-key",
                "name": "父源",
                "rest_api": "demo/parent",
                "params": package_params,
                "identity": {"kind": "portable", "portable_key": "parent-key"},
            }
        ]
    )
    conflicts = PrecheckService.identify_conflicts(doc, current_team=1)
    assert conflicts[0]["reason"] == ConflictReason.IDENTITY_CONFIG_CONFLICT
    result = _service(doc, {"portable::parent-key": ConflictAction.REUSE_TARGET.value}).execute()
    assert result["success"] is True
    parent.refresh_from_db()
    assert parent.params[0]["inputConfig"]["optionsSource"]["sourceId"] == child.id
    assert "sourceRef" not in parent.params[0]["inputConfig"]["optionsSource"]
    assert DataSourceAPIModel.objects.filter(portable_key="parent-key").count() == 1


@pytest.mark.django_db
def test_same_nested_identity_with_different_numeric_ids_is_not_a_conflict():
    child = DataSourceAPIModel.objects.create(
        name="子源",
        rest_api="demo/child",
        portable_key="child-key",
        params=[],
        created_by="s",
        updated_by="s",
        groups=[1],
    )
    parent = _window(
        name="父源",
        rest_api="demo/parent",
        portable_key="parent-key",
        params=[{"name": "option", "inputConfig": {"optionsSource": {"type": "dynamic", "sourceId": child.id}}}],
    )
    doc = _doc(
        datasources=[
            {
                "key": "portable::parent-key",
                "name": "父源",
                "rest_api": "demo/parent",
                "params": [
                    {
                        "name": "option",
                        "inputConfig": {
                            "optionsSource": {
                                "type": "dynamic",
                                "sourceRef": {"type": "rest_api", "value": "portable::child-key"},
                            }
                        },
                    }
                ],
                "identity": {"kind": "portable", "portable_key": "parent-key"},
            }
        ]
    )
    assert PrecheckService.identify_conflicts(doc, current_team=1) == []
    result = _service(doc).execute()
    assert result["success"] is True
    parent.refresh_from_db()
    assert parent.params[0]["inputConfig"]["optionsSource"]["sourceId"] == child.id


@pytest.mark.django_db
def test_hidden_identity_conflict_does_not_leak_the_target():
    hidden = _window(name="生产环境七天窗口", groups=[9])
    doc = _doc(datasources=[_identity_section(days=30, name="导入包里的名字")])
    conflicts = PrecheckService.identify_conflicts(doc, current_team=1)
    assert conflicts[0]["reason"] == ConflictReason.NO_PERMISSION_CONFLICT
    assert conflicts[0]["suggested_actions"] == [ConflictAction.IMPORT_AS_NEW.value]
    dumped = str(conflicts[0])
    assert hidden.name not in dumped
    assert str(hidden.id) not in dumped


@pytest.mark.django_db
def test_empty_rest_api_source_still_uses_portable_identity():
    section = _identity_section(days=1, rest_api="", name="手工表")
    section["source_type"] = "mysql"
    doc = _doc(datasources=[section])
    result = _service(doc).execute()
    assert result["success"] is True
    row = DataSourceAPIModel.objects.get()
    assert row.rest_api == ""
    assert row.portable_key == WINDOW_KEY
    assert row.is_build_in is False


@pytest.mark.django_db
def test_cycle_is_written_before_refs_are_remapped():
    left = {
        "key": "portable::left",
        "name": "左",
        "rest_api": "demo/left",
        "params": [{"name": "option", "inputConfig": {"optionsSource": {"sourceRef": {"type": "rest_api", "value": "portable::right"}}}}],
        "identity": {"kind": "portable", "portable_key": "left"},
    }
    right = {
        "key": "portable::right",
        "name": "右",
        "rest_api": "demo/right",
        "params": [{"name": "option", "inputConfig": {"optionsSource": {"sourceRef": {"type": "rest_api", "value": "portable::left"}}}}],
        "identity": {"kind": "portable", "portable_key": "right"},
    }
    result = _service(_doc(datasources=[left, right])).execute()
    assert result["success"] is True
    rows = {row.portable_key: row for row in DataSourceAPIModel.objects.all()}
    assert rows["left"].params[0]["inputConfig"]["optionsSource"]["sourceId"] == rows["right"].id
    assert rows["right"].params[0]["inputConfig"]["optionsSource"]["sourceId"] == rows["left"].id


@pytest.mark.django_db
def test_builtin_seed_updates_in_place_and_user_copy_is_not_stamped():
    builtin = DataSourceAPIModel.objects.create(
        name="已改名",
        rest_api="demo/builtin",
        is_build_in=True,
        build_in_key="稳定::demo/builtin",
        desc="旧描述",
        params=[{"name": "option", "inputConfig": {"optionsSource": {"sourceRef": {"type": "rest_api", "value": "稳定::demo/nested"}}}}],
        created_by="s",
        updated_by="s",
        groups=[],
    )
    user = DataSourceAPIModel.objects.create(
        name="包内名称",
        rest_api="demo/user",
        desc="用户的",
        created_by="s",
        updated_by="s",
        groups=[1],
    )
    doc = _doc(
        datasources=[
            {
                "key": "稳定::demo/nested",
                "name": "嵌套内置",
                "rest_api": "demo/nested",
                "params": [],
                "identity": {"kind": "builtin", "build_in_key": "稳定::demo/nested"},
            },
            {
                "key": "稳定::demo/builtin",
                "name": "包内名称",
                "rest_api": "demo/builtin",
                "desc": "种子新描述",
                "params": [{"name": "option", "inputConfig": {"optionsSource": {"sourceRef": {"type": "rest_api", "value": "稳定::demo/nested"}}}}],
                "identity": {"kind": "builtin", "build_in_key": "稳定::demo/builtin"},
            },
        ]
    )
    result = _service(doc, builtin_seed=True).execute()
    assert result["success"] is True
    builtin.refresh_from_db()
    user.refresh_from_db()
    nested = DataSourceAPIModel.objects.get(build_in_key="稳定::demo/nested")
    assert builtin.id
    assert builtin.desc == "种子新描述"
    assert builtin.params[0]["inputConfig"]["optionsSource"]["sourceId"] == nested.id
    assert user.is_build_in is False
    assert user.desc == "用户的"
    assert user.build_in_key in (None, "")


@pytest.mark.django_db(transaction=True)
def test_overlapping_imports_of_one_new_identity_keep_a_single_row(monkeypatch):
    """一条身份正在写入时，另一条导入不能再落第二行。锁放开后要么复用，要么整单回滚。"""
    close_old_connections()
    doc = _doc(
        datasources=[_identity_section(days=7, key="portable::race-key", portable_key="race-key", name="并发窗口")],
        dashboards=[
            {
                "key": "dashboard::并发",
                "name": "并发画布",
                "desc": "",
                "other": {},
                "filters": [],
                "view_sets": [{"id": "w1", "valueConfig": {"dataSource": "portable::race-key"}}],
            }
        ],
    )
    held = threading.Event()
    release = threading.Event()
    entered = threading.Event()
    from apps.operation_analysis.services.import_export.datasource_package_identity import find_identity_row

    def find_and_signal(item, *, lock=False):
        entered.set()
        return find_identity_row(item, lock=lock)

    monkeypatch.setattr(
        "apps.operation_analysis.services.import_export.import_service.find_identity_row",
        find_and_signal,
    )

    def hold_identity():
        close_old_connections()
        try:
            with transaction.atomic():
                DataSourceAPIModel.objects.create(
                    name="并发窗口",
                    rest_api="demo/window",
                    source_type="nats",
                    desc="",
                    params=_days(7),
                    portable_key="race-key",
                    groups=[1],
                    created_by="s",
                    updated_by="s",
                )
                held.set()
                assert release.wait(timeout=10)
        finally:
            close_old_connections()

    def import_while_held():
        assert held.wait(timeout=10)
        close_old_connections()
        try:
            return _service(doc).execute()
        except Exception as exc:  # noqa: BLE001
            return exc
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(hold_identity)
        assert held.wait(timeout=10)
        importer = pool.submit(import_while_held)
        assert entered.wait(timeout=10)
        release.set()
        holder.result(timeout=20)
        outcome = importer.result(timeout=20)

    rows = list(DataSourceAPIModel.objects.filter(portable_key="race-key"))
    assert len(rows) == 1, outcome
    assert rows[0].params[0]["value"] == 7
    assert DataSourceAPIModel.objects.exclude(portable_key="race-key").count() == 0
    for dashboard in Dashboard.objects.all():
        assert dashboard.view_sets[0]["valueConfig"]["dataSource"] == rows[0].id
