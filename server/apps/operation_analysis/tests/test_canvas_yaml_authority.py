"""仪表盘/大屏 YAML 权威交付：稳定键、目录路径与数据源复用。"""

import json
from io import StringIO
from pathlib import Path

import pytest
import yaml
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.operation_analysis.constants.import_export import YAML_SCHEMA_VERSION, ConflictAction, ImportExportErrorCode, ObjectType, ScopeType
from apps.operation_analysis.models.datasource_models import DataSourceAPIModel, NameSpace
from apps.operation_analysis.models.models import Dashboard, Directory, Screen, Topology
from apps.operation_analysis.schemas.import_export_schema import YAMLDocument
from apps.operation_analysis.serializers.import_export_serializers import ImportPrecheckRequestSerializer, ImportSubmitRequestSerializer
from apps.operation_analysis.services.canvas_draft.codec import encode_yaml
from apps.operation_analysis.services.import_export.export_service import ExportService
from apps.operation_analysis.services.import_export.import_service import ImportService
from apps.operation_analysis.services.import_export.precheck_service import PrecheckService
from apps.operation_analysis.views import view as view_module

SCREEN_VIEW_SETS = {"viewport": {"width": 1920, "height": 1080}, "items": [], "decorations": {}}


def _doc(**sections):
    data = {"meta": {"schema_version": YAML_SCHEMA_VERSION}}
    data.update(sections)
    return YAMLDocument(**data)


def _dashboard(key="dashboard::db-a", name="db-a", **over):
    base = {"key": key, "name": name, "desc": "", "other": {}, "view_sets": [], "filters": []}
    base.update(over)
    return base


def _screen(key="screen::screen-a", name="screen-a", **over):
    base = {"key": key, "name": name, "desc": "", "other": {}, "view_sets": SCREEN_VIEW_SETS}
    base.update(over)
    return base


def _topology(key="topology::topo-a", name="topo-a", **over):
    base = {"key": key, "name": name, "desc": "", "other": {}, "view_sets": {"nodes": [], "edges": [], "filters": []}}
    base.update(over)
    return base


def _namespace(key="ns1", name="ns-a", **over):
    base = {
        "key": key,
        "name": name,
        "domain": "127.0.0.1:4222",
        "namespace": "bklite",
        "account": "admin",
        "password": "secret",
        "enable_tls": False,
        "desc": "",
    }
    base.update(over)
    return base


def _datasource(key="ds1::monitor/query", name="ds-a", **over):
    base = {
        "key": key,
        "name": name,
        "rest_api": "monitor/query",
        "desc": "from-package",
        "params": [],
        "tags": [],
        "chart_type": [],
        "field_schema": [],
        "namespace_keys": [],
    }
    base.update(over)
    return base


def _service(doc, **over):
    kwargs = dict(
        doc=doc,
        target_directory_id=None,
        conflict_decisions={},
        secret_supplements={},
        created_by="tester",
        updated_by="tester",
        groups=[1],
        conflict_policy="key_overwrite",
    )
    kwargs.update(over)
    return ImportService(**kwargs)


def _codes(result):
    return [item.get("code") for item in result["results"] if item.get("status") == "failed"]


def _directory(name, parent=None, groups=None):
    return Directory.objects.create(name=name, parent=parent, groups=groups if groups is not None else [7], created_by="tester")


@pytest.mark.django_db
def test_key_overwrite_updates_same_row_and_keeps_identity_after_rename():
    directory = _directory("交付目录")
    existing = Dashboard.objects.create(
        name="旧名称",
        desc="old",
        canvas_key="dashboard::stable-1",
        directory=directory,
        groups=[7],
        created_by="tester",
    )
    doc = _doc(
        dashboards=[
            _dashboard(
                key="dashboard::新名称",
                name="新名称",
                desc="new",
                canvas_key="dashboard::stable-1",
                directory_path="交付目录",
                view_sets=[{"id": "w1"}],
            )
        ]
    )

    result = _service(doc).execute()

    assert result["success"] is True
    assert result["summary"]["overwritten"] == 1
    existing.refresh_from_db()
    assert existing.name == "新名称"
    assert existing.desc == "new"
    assert existing.canvas_key == "dashboard::stable-1"
    assert existing.view_sets == [{"id": "w1"}]
    assert Dashboard.objects.count() == 1


@pytest.mark.django_db
def test_old_package_without_canvas_key_matches_name_and_writes_key_back():
    directory = _directory("交付目录")
    existing = Dashboard.objects.create(name="db-a", desc="old", directory=directory, groups=[7], created_by="tester")
    doc = _doc(dashboards=[_dashboard(desc="from-old-package", directory_path="交付目录")])

    result = _service(doc).execute()

    assert result["success"] is True
    existing.refresh_from_db()
    assert existing.desc == "from-old-package"
    assert existing.canvas_key.startswith("dashboard::")
    stored_key = existing.canvas_key

    renamed = _doc(
        dashboards=[
            _dashboard(
                key="dashboard::改名后",
                name="改名后",
                desc="renamed",
                canvas_key=stored_key,
                directory_path="交付目录",
            )
        ]
    )
    again = _service(renamed).execute()
    assert again["success"] is True
    existing.refresh_from_db()
    assert existing.pk
    assert existing.name == "改名后"
    assert existing.canvas_key == stored_key
    assert Dashboard.objects.count() == 1


@pytest.mark.django_db
def test_user_canvas_key_colliding_with_builtin_key_rolls_back():
    screen = Screen.objects.create(
        name="内置大屏",
        is_build_in=True,
        build_in_key="screen::builtin-host",
        view_sets=SCREEN_VIEW_SETS,
        groups=[1],
        created_by="system",
    )
    directory = _directory("交付目录")
    doc = _doc(
        namespaces=[_namespace()],
        dashboards=[
            _dashboard(canvas_key="screen::builtin-host", directory_path="交付目录"),
        ],
    )

    result = _service(doc, target_directory_id=directory.id).execute()

    assert result["success"] is False
    assert ImportExportErrorCode.IMPORT_BUILTIN_KEY_REJECTED in _codes(result)
    screen.refresh_from_db()
    assert screen.name == "内置大屏"
    assert screen.is_build_in is True
    assert not NameSpace.objects.filter(name="ns-a").exists()
    assert not Dashboard.objects.filter(name="db-a").exists()


@pytest.mark.django_db
def test_key_overwrite_refuses_to_modify_builtin_canvas_matched_by_name():
    builtin = Dashboard.objects.create(
        name="内置仪表盘",
        desc="builtin",
        is_build_in=True,
        build_in_key="dashboard::builtin-board",
        groups=[1],
        created_by="system",
    )
    doc = _doc(dashboards=[_dashboard(key="dashboard::内置仪表盘", name="内置仪表盘", desc="hijack", directory_path="交付目录")])
    _directory("交付目录")

    result = _service(doc).execute()

    assert result["success"] is False
    assert ImportExportErrorCode.IMPORT_BUILTIN_PROTECTED in _codes(result)
    builtin.refresh_from_db()
    assert builtin.desc == "builtin"
    assert builtin.canvas_key in (None, "")


@pytest.mark.django_db
def test_key_overwrite_does_not_clobber_other_row_when_name_is_taken():
    directory = _directory("交付目录")
    owner = Dashboard.objects.create(name="占用名", canvas_key="dashboard::other", directory=directory, groups=[7], created_by="tester")
    doc = _doc(
        dashboards=[
            _dashboard(name="占用名", canvas_key="dashboard::fresh", directory_path="交付目录"),
        ]
    )

    result = _service(doc).execute()

    assert result["success"] is False
    assert ImportExportErrorCode.IMPORT_CANVAS_NAME_TAKEN in _codes(result)
    owner.refresh_from_db()
    assert owner.canvas_key == "dashboard::other"
    assert Dashboard.objects.filter(canvas_key="dashboard::fresh").count() == 0


@pytest.mark.django_db
def test_page_import_rename_keeps_package_canvas_key_on_new_row():
    directory = _directory("页面目录", groups=[3])
    Dashboard.objects.create(name="db-a", groups=[3], directory=directory, created_by="tester")
    doc = _doc(dashboards=[_dashboard(canvas_key="dashboard::from-package", directory_path="不会被使用")])

    result = _service(doc, target_directory_id=directory.id, conflict_policy=None).execute()

    created = Dashboard.objects.get(canvas_key="dashboard::from-package")
    assert result["success"] is True
    assert created.name == "db-a_copy"
    assert created.directory_id == directory.id
    assert Dashboard.objects.filter(name="db-a").count() == 1


@pytest.mark.django_db
def test_export_writes_stable_canvas_key_and_directory_path():
    parent = _directory("运营", groups=[4])
    child = _directory("值班", parent=parent, groups=[4])
    dashboard = Dashboard.objects.create(name="值班面板", directory=child, groups=[4], desc="v1", created_by="tester")

    first = ExportService.export_objects(ScopeType.CANVAS.value, ObjectType.DASHBOARD.value, [dashboard.id])
    parsed = yaml.safe_load(first["yaml_content"])
    item = parsed["dashboards"][0]
    dashboard.refresh_from_db()

    assert item["key"] == "dashboard::值班面板"
    assert item["canvas_key"] == dashboard.canvas_key
    assert item["canvas_key"].startswith("dashboard::")
    assert item["directory_path"] == "运营/值班"
    assert "organization_id" not in item

    dashboard.name = "值班面板改名"
    dashboard.save(update_fields=["name", "updated_at"])
    second = ExportService.export_objects(ScopeType.CANVAS.value, ObjectType.DASHBOARD.value, [dashboard.id])
    exported_again = yaml.safe_load(second["yaml_content"])["dashboards"][0]
    assert exported_again["key"] == "dashboard::值班面板改名"
    assert exported_again["canvas_key"] == item["canvas_key"]


@pytest.mark.django_db
def test_builtin_and_draft_export_do_not_persist_user_canvas_key():
    builtin = Dashboard.objects.create(
        name="内置面板",
        is_build_in=True,
        build_in_key="dashboard::builtin-panel",
        groups=[1],
        created_by="system",
    )
    exported = ExportService.convert_canvas_to_yaml(builtin, ObjectType.DASHBOARD, {}, {})
    builtin.refresh_from_db()
    assert "canvas_key" not in exported
    assert builtin.canvas_key in (None, "")

    draft_source = Dashboard.objects.create(name="草稿源", groups=[1], created_by="tester")
    with CaptureQueriesContext(connection) as captured:
        encode_yaml(draft_source, {"name": "草稿源", "desc": "", "view_sets": [], "other": {}}, ObjectType.DASHBOARD, {}, {})
    draft_source.refresh_from_db()
    assert captured.captured_queries == []
    assert draft_source.canvas_key in (None, "")


@pytest.mark.django_db
def test_directory_path_resolution_follows_directory_not_package_organization():
    parent = _directory("组织甲", groups=[11])
    child = _directory("子目录", parent=parent, groups=[11])
    _directory("同名叶子", groups=[99])
    doc = _doc(dashboards=[_dashboard(canvas_key="dashboard::path-1", directory_path="组织甲/子目录")])
    doc.meta.source.organization_id = 99

    result = _service(doc, groups=[1]).execute()

    assert result["success"] is True
    dashboard = Dashboard.objects.get(canvas_key="dashboard::path-1")
    assert dashboard.directory_id == child.id
    assert dashboard.groups == [11]


@pytest.mark.django_db
def test_missing_directory_path_does_not_create_directories():
    _directory("已有")
    doc = _doc(dashboards=[_dashboard(canvas_key="dashboard::missing", directory_path="已有/缺失")])

    result = _service(doc).execute()

    assert result["success"] is False
    assert ImportExportErrorCode.IMPORT_DIRECTORY_PATH_NOT_FOUND in _codes(result)
    assert Directory.objects.filter(name="缺失").count() == 0
    assert not Dashboard.objects.filter(canvas_key="dashboard::missing").exists()


@pytest.mark.django_db
def test_key_overwrite_without_path_requires_directory_argument():
    doc = _doc(dashboards=[_dashboard(canvas_key="dashboard::no-path")])

    missing = _service(doc).execute()
    assert ImportExportErrorCode.IMPORT_DIRECTORY_PATH_REQUIRED in _codes(missing)

    directory = _directory("参数目录", groups=[5])
    created = _service(doc, target_directory_id=directory.id).execute()
    assert created["success"] is True
    assert Dashboard.objects.get(canvas_key="dashboard::no-path").directory_id == directory.id


@pytest.mark.django_db
def test_directory_path_wins_over_target_directory_under_key_overwrite():
    path_directory = _directory("路径目录", groups=[8])
    selected = _directory("页面所选", groups=[2])
    doc = _doc(dashboards=[_dashboard(canvas_key="dashboard::path-wins", directory_path="路径目录")])

    result = _service(doc, target_directory_id=selected.id).execute()

    assert result["success"] is True
    assert Dashboard.objects.get(canvas_key="dashboard::path-wins").directory_id == path_directory.id


@pytest.mark.django_db
def test_page_import_ignores_directory_path():
    packaged = _directory("包内目录", groups=[6])
    selected = _directory("页面目录", groups=[6])
    doc = _doc(dashboards=[_dashboard(directory_path="包内目录")])

    result = _service(doc, target_directory_id=selected.id, conflict_policy=None, groups=[1]).execute()

    assert result["success"] is True
    dashboard = Dashboard.objects.get(name="db-a")
    assert dashboard.directory_id == selected.id
    assert dashboard.directory_id != packaged.id


@pytest.mark.django_db
def test_prefer_existing_reuses_datasource_and_namespace_and_creates_missing_source():
    target = _directory("交付目录", groups=[4])
    namespace = NameSpace.objects.create(name="ns-a", domain="old", account="old", password="kept-secret")
    existing = DataSourceAPIModel.objects.create(
        name="ds-a",
        rest_api="monitor/query",
        desc="local-definition",
        groups=[4],
        created_by="local",
        updated_by="local",
    )
    doc = _doc(
        namespaces=[_namespace(password="package-secret", domain="package-host")],
        datasources=[
            _datasource(namespace_keys=["ns1"], desc="package-definition"),
            _datasource(key="ds-new::monitor/query", name="ds-new", desc="created-from-package"),
        ],
        dashboards=[
            _dashboard(
                canvas_key="dashboard::with-ds",
                directory_path="交付目录",
                view_sets=[{"valueConfig": {"dataSource": "ds1::monitor/query"}}],
                refs={"datasource_keys": ["ds1::monitor/query"]},
            )
        ],
    )

    result = _service(doc, inherit_directory_groups=True).execute()

    assert result["success"] is True
    existing.refresh_from_db()
    namespace.refresh_from_db()
    created = DataSourceAPIModel.objects.get(name="ds-new")
    assert existing.desc == "local-definition"
    assert namespace.domain == "old"
    assert namespace.decrypt_password == "kept-secret"
    assert created.desc == "created-from-package"
    assert created.groups == [4]
    dashboard = Dashboard.objects.get(canvas_key="dashboard::with-ds")
    assert dashboard.groups == [4]
    assert dashboard.directory_id == target.id
    assert dashboard.view_sets[0]["valueConfig"]["dataSource"] == existing.id


@pytest.mark.django_db
def test_duplicate_canvas_key_is_rejected_before_import():
    _directory("交付目录")
    doc = _doc(
        dashboards=[
            _dashboard(key="dashboard::one", name="one", canvas_key="dashboard::same", directory_path="交付目录"),
            _dashboard(key="dashboard::two", name="two", canvas_key="dashboard::same", directory_path="交付目录"),
        ]
    )

    result = _service(doc).execute()

    assert result["success"] is False
    assert ImportExportErrorCode.IMPORT_CANVAS_KEY_DUPLICATED in _codes(result)
    assert Dashboard.objects.count() == 0


@pytest.mark.django_db
def test_topology_import_is_unchanged_and_has_no_user_canvas_key():
    directory = _directory("拓扑目录", groups=[3])
    doc = _doc(topologies=[_topology()])

    result = _service(doc, target_directory_id=directory.id, conflict_policy=None).execute()

    assert result["success"] is True
    topology = Topology.objects.get(name="topo-a")
    assert topology.directory_id == directory.id
    assert not hasattr(topology, "canvas_key")


def _yaml_document(**sections):
    counts = {name: len(items) for name, items in sections.items()}
    return {
        "meta": {"schema_version": YAML_SCHEMA_VERSION, "object_counts": counts},
        **sections,
    }


@pytest.mark.django_db
def test_precheck_reports_invalid_path_and_accepts_keyed_dashboard_without_target_directory():
    _directory("交付目录")
    valid = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[_dashboard(canvas_key="dashboard::ok", directory_path="交付目录")])),
        conflict_policy="key_overwrite",
    )
    assert valid["valid"] is True, valid["errors"]

    invalid = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[_dashboard(canvas_key="dashboard::bad", directory_path="/交付目录/")])),
        conflict_policy="key_overwrite",
    )
    assert invalid["valid"] is False
    assert invalid["errors"][0]["code"] == ImportExportErrorCode.IMPORT_DIRECTORY_PATH_INVALID


def test_import_serializers_accept_authority_options_and_reject_unknown_policy():
    payload = {"yaml_content": "meta: {}\n", "conflict_policy": "key_overwrite", "datasource_resolve": "prefer_existing"}
    precheck = ImportPrecheckRequestSerializer(data=payload)
    submit = ImportSubmitRequestSerializer(data=payload)
    assert precheck.is_valid(), precheck.errors
    assert submit.is_valid(), submit.errors
    assert precheck.validated_data["conflict_policy"] == "key_overwrite"

    rejected = ImportSubmitRequestSerializer(data={"yaml_content": "meta: {}\n", "conflict_policy": "merge"})
    assert not rejected.is_valid()
    assert "conflict_policy" in rejected.errors


@pytest.mark.django_db
def test_api_create_allocates_canvas_key_and_patch_rename_keeps_it(authenticated_user):
    user = authenticated_user
    user.is_superuser = True
    directory = _directory("接口目录", groups=[1])
    factory = APIRequestFactory()
    request = factory.post(
        "/dashboard/",
        data={
            "name": "接口面板",
            "groups": [1],
            "directory": directory.id,
            "view_sets": [],
            "canvas_key": "dashboard::client-supplied",
        },
        format="json",
    )
    request.COOKIES["current_team"] = "1"
    force_authenticate(request, user=user)

    response = view_module.DashboardModelViewSet.as_view({"post": "create"})(request)
    response.render()
    payload = json.loads(response.rendered_content)

    assert response.status_code == status.HTTP_201_CREATED
    created = Dashboard.objects.get(name="接口面板")
    assert created.canvas_key.startswith("dashboard::")
    assert created.canvas_key != "dashboard::client-supplied"
    assert payload["data"]["canvas_key"] == created.canvas_key

    patch = factory.patch(f"/dashboard/{created.id}/", data={"name": "接口面板改名"}, format="json")
    patch.COOKIES["current_team"] = "1"
    force_authenticate(patch, user=user)
    patched = view_module.DashboardModelViewSet.as_view({"patch": "partial_update"})(patch, pk=str(created.id))
    assert patched.status_code == status.HTTP_200_OK
    created.refresh_from_db()
    assert created.name == "接口面板改名"
    assert created.canvas_key == payload["data"]["canvas_key"]


@pytest.mark.django_db
def test_builtin_sync_does_not_assign_user_canvas_key():
    directory = _directory("内置目录", groups=[1])
    existing = Dashboard.objects.create(
        name="内置面板",
        desc="old",
        is_build_in=True,
        build_in_key="dashboard::builtin-panel",
        directory=directory,
        groups=[1],
        created_by="system",
    )
    doc = _doc(dashboards=[_dashboard(key="dashboard::builtin-panel", name="内置面板", desc="synced")])

    result = _service(
        doc,
        target_directory_id=directory.id,
        conflict_policy=None,
        conflict_decisions={"dashboard::builtin-panel": ConflictAction.OVERWRITE.value},
        existing_canvas_ids={("dashboard", "dashboard::builtin-panel"): existing.id},
        assign_user_canvas_key=False,
        preserve_existing_canvas_groups=True,
    ).execute()

    assert result["success"] is True
    existing.refresh_from_db()
    assert existing.desc == "synced"
    assert existing.canvas_key in (None, "")
    assert existing.is_build_in is True


@pytest.mark.django_db
def test_apply_canvas_yaml_command_creates_then_overwrites(tmp_path: Path):
    directory = _directory("命令目录", groups=[9])
    document = _yaml_document(
        dashboards=[
            _dashboard(name="命令面板", desc="v1", canvas_key="dashboard::cli-1", directory_path="命令目录"),
        ],
        screens=[
            _screen(canvas_key="screen::cli-1", directory_path="命令目录"),
        ],
    )
    yaml_path = tmp_path / "canvas.yaml"
    yaml_path.write_text(yaml.safe_dump(document, allow_unicode=True), encoding="utf-8")

    stdout = StringIO()
    call_command("apply_canvas_yaml", file=str(yaml_path), stdout=stdout)
    dashboard = Dashboard.objects.get(canvas_key="dashboard::cli-1")
    screen = Screen.objects.get(canvas_key="screen::cli-1")
    assert "apply_canvas_yaml success" in stdout.getvalue()
    assert dashboard.desc == "v1"
    assert dashboard.directory_id == directory.id
    assert screen.directory_id == directory.id

    document["dashboards"][0]["name"] = "命令面板改名"
    document["dashboards"][0]["desc"] = "v2"
    document["dashboards"][0]["key"] = "dashboard::命令面板改名"
    yaml_path.write_text(yaml.safe_dump(document, allow_unicode=True), encoding="utf-8")
    call_command("apply_canvas_yaml", file=str(yaml_path), policy="key_overwrite", datasource_resolve="prefer_existing")
    dashboard.refresh_from_db()
    assert dashboard.name == "命令面板改名"
    assert dashboard.desc == "v2"
    assert dashboard.canvas_key == "dashboard::cli-1"
    assert Dashboard.objects.count() == 1
    assert Screen.objects.count() == 1

    missing = tmp_path / "missing.yaml"
    with pytest.raises(CommandError, match="不存在"):
        call_command("apply_canvas_yaml", file=str(missing))


def _failed_messages(result):
    return " ".join(item.get("message") or "" for item in result["results"] if item.get("status") == "failed")


@pytest.mark.django_db
def test_http_key_overwrite_rejects_invisible_and_builtin_directories():
    home = _directory("可见目录", groups=[1])
    hidden = _directory("看不见", groups=[99])
    Directory.objects.create(name="内置目录", is_build_in=True, groups=[1], created_by="tester")
    existing = Dashboard.objects.create(
        name="已有",
        canvas_key="dashboard::stay",
        directory=home,
        groups=[1],
        created_by="tester",
    )
    hidden_item = _dashboard(name="已有", canvas_key="dashboard::stay", directory_path="看不见")
    hidden_precheck = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[hidden_item])),
        conflict_policy="key_overwrite",
        current_team=1,
        enforce_directory_visibility=True,
    )
    assert hidden_precheck["valid"] is False
    assert hidden_precheck["errors"][0]["code"] == ImportExportErrorCode.IMPORT_DIRECTORY_NOT_VISIBLE

    result = _service(_doc(dashboards=[hidden_item]), current_team=1, enforce_directory_visibility=True).execute()
    assert result["success"] is False
    assert ImportExportErrorCode.IMPORT_DIRECTORY_NOT_VISIBLE in _codes(result)
    existing.refresh_from_db()
    assert existing.directory_id == home.id
    assert existing.groups == [1]

    fallback = _service(
        _doc(dashboards=[_dashboard(canvas_key="dashboard::fallback")]),
        target_directory_id=hidden.id,
        current_team=1,
        enforce_directory_visibility=True,
    ).execute()
    assert ImportExportErrorCode.IMPORT_DIRECTORY_NOT_VISIBLE in _codes(fallback)
    assert not Dashboard.objects.filter(canvas_key="dashboard::fallback").exists()

    builtin_result = _service(
        _doc(dashboards=[_dashboard(canvas_key="dashboard::into-builtin", directory_path="内置目录")]),
        current_team=1,
        enforce_directory_visibility=True,
    ).execute()
    assert ImportExportErrorCode.IMPORT_DIRECTORY_BUILTIN in _codes(builtin_result)
    assert not Dashboard.objects.filter(canvas_key="dashboard::into-builtin").exists()

    superuser = _service(
        _doc(dashboards=[_dashboard(canvas_key="dashboard::super", directory_path="看不见")]),
        current_team=1,
        enforce_directory_visibility=True,
        directory_visibility_superuser=True,
    ).execute()
    assert superuser["success"] is True
    assert Dashboard.objects.get(canvas_key="dashboard::super").directory_id == hidden.id

    super_builtin = _service(
        _doc(dashboards=[_dashboard(canvas_key="dashboard::super-builtin", directory_path="内置目录")]),
        current_team=1,
        enforce_directory_visibility=True,
        directory_visibility_superuser=True,
    ).execute()
    assert ImportExportErrorCode.IMPORT_DIRECTORY_BUILTIN in _codes(super_builtin)


@pytest.mark.django_db
def test_same_name_directories_are_ambiguous_unless_http_team_owns_exactly_one():
    other = _directory("对方目录", groups=[99])
    cli_doc = _doc(dashboards=[_dashboard(canvas_key="dashboard::cli-org", directory_path="对方目录")])
    cli_result = _service(cli_doc, groups=[1]).execute()
    assert cli_result["success"] is True
    bound = Dashboard.objects.get(canvas_key="dashboard::cli-org")
    assert bound.directory_id == other.id
    assert bound.groups == [99]

    left = _directory("同名根", groups=[1])
    right = _directory("同名根", groups=[2])
    ambiguous_item = _dashboard(canvas_key="dashboard::ambiguous", directory_path="同名根")
    precheck = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[ambiguous_item])),
        conflict_policy="key_overwrite",
    )
    assert precheck["valid"] is False
    assert precheck["errors"][0]["code"] == ImportExportErrorCode.IMPORT_DIRECTORY_PATH_AMBIGUOUS
    assert str(left.id) in precheck["errors"][0]["message"]
    assert str(right.id) in precheck["errors"][0]["message"]
    assert "groups=" in precheck["errors"][0]["message"]

    imported = _service(_doc(dashboards=[ambiguous_item])).execute()
    assert ImportExportErrorCode.IMPORT_DIRECTORY_PATH_AMBIGUOUS in _codes(imported)
    assert str(left.id) in _failed_messages(imported)
    assert str(right.id) in _failed_messages(imported)
    assert not Dashboard.objects.filter(canvas_key="dashboard::ambiguous").exists()

    owned = _service(
        _doc(dashboards=[_dashboard(name="本组织面板", canvas_key="dashboard::owned", directory_path="同名根")]),
        current_team=1,
        enforce_directory_visibility=True,
    ).execute()
    assert owned["success"] is True
    assert Dashboard.objects.get(canvas_key="dashboard::owned").directory_id == left.id

    invisible = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[ambiguous_item])),
        conflict_policy="key_overwrite",
        current_team=3,
        enforce_directory_visibility=True,
    )
    assert invisible["errors"][0]["code"] == ImportExportErrorCode.IMPORT_DIRECTORY_NOT_VISIBLE
    assert str(left.id) in invisible["errors"][0]["message"]
    assert str(right.id) in invisible["errors"][0]["message"]
    untouched = _service(
        _doc(dashboards=[ambiguous_item]),
        current_team=3,
        enforce_directory_visibility=True,
    ).execute()
    assert ImportExportErrorCode.IMPORT_DIRECTORY_NOT_VISIBLE in _codes(untouched)
    assert not Dashboard.objects.filter(canvas_key="dashboard::ambiguous").exists()


@pytest.mark.django_db
def test_reserved_builtin_key_blocks_new_writes_but_not_the_holding_user_row(monkeypatch):
    from apps.operation_analysis.services.import_export import canvas_authority

    monkeypatch.setattr(canvas_authority, "reserved_builtin_key_catalog", lambda: {"dashboard::reserved-unsynced"})
    directory = _directory("交付目录", groups=[1])
    holder = Dashboard.objects.create(
        name="先占",
        canvas_key="dashboard::reserved-unsynced",
        is_build_in=False,
        directory=directory,
        groups=[1],
        created_by="tester",
        desc="old",
    )
    held_item = _dashboard(
        name="先占改名",
        canvas_key="dashboard::reserved-unsynced",
        directory_path="交付目录",
        desc="updated",
    )
    held_precheck = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[held_item])),
        conflict_policy="key_overwrite",
    )
    assert held_precheck["valid"] is True, held_precheck["errors"]
    overwritten = _service(_doc(dashboards=[held_item])).execute()
    assert overwritten["success"] is True, overwritten
    holder.refresh_from_db()
    assert holder.desc == "updated"
    assert holder.name == "先占改名"
    assert holder.canvas_key == "dashboard::reserved-unsynced"
    assert holder.is_build_in is False
    assert Dashboard.objects.count() == 1

    fresh_item = _dashboard(name="新行", canvas_key="dashboard::not-yet-written", directory_path="交付目录")
    monkeypatch.setattr(canvas_authority, "reserved_builtin_key_catalog", lambda: {"dashboard::not-yet-written"})
    fresh_precheck = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[fresh_item])),
        conflict_policy="key_overwrite",
    )
    assert fresh_precheck["errors"][0]["code"] == ImportExportErrorCode.IMPORT_BUILTIN_KEY_REJECTED
    rejected = _service(_doc(dashboards=[fresh_item])).execute()
    assert ImportExportErrorCode.IMPORT_BUILTIN_KEY_REJECTED in _codes(rejected)
    assert not Dashboard.objects.filter(canvas_key="dashboard::not-yet-written").exists()

    builtin = Dashboard.objects.create(
        name="内置行",
        canvas_key="dashboard::held-by-builtin",
        is_build_in=True,
        build_in_key="dashboard::held-by-builtin",
        directory=directory,
        groups=[1],
        created_by="system",
        desc="builtin",
    )
    monkeypatch.setattr(canvas_authority, "reserved_builtin_key_catalog", lambda: {"dashboard::held-by-builtin"})
    protected = _service(
        _doc(dashboards=[_dashboard(name="内置行", canvas_key="dashboard::held-by-builtin", directory_path="交付目录", desc="hijack")])
    ).execute()
    assert ImportExportErrorCode.IMPORT_BUILTIN_PROTECTED in _codes(protected)
    builtin.refresh_from_db()
    assert builtin.desc == "builtin"


@pytest.mark.django_db
def test_support_file_builtin_key_is_reserved_before_it_is_synced():
    from apps.operation_analysis.services.import_export import canvas_authority

    if hasattr(canvas_authority.reserved_builtin_key_catalog, "_cache"):
        del canvas_authority.reserved_builtin_key_catalog._cache
    assert "dashboard::CMDB仪表盘_内置" in canvas_authority.reserved_builtin_key_catalog()

    _directory("交付目录")
    result = _service(
        _doc(dashboards=[_dashboard(canvas_key="dashboard::CMDB仪表盘_内置", directory_path="交付目录")])
    ).execute()
    assert ImportExportErrorCode.IMPORT_BUILTIN_KEY_REJECTED in _codes(result)
    assert not Dashboard.objects.filter(canvas_key="dashboard::CMDB仪表盘_内置").exists()


@pytest.mark.django_db
def test_key_overwrite_datasources_follow_each_directory_and_reject_cross_org_packages():
    _directory("甲", groups=[4])
    created = _service(
        _doc(
            datasources=[_datasource(key="fresh::monitor/query", name="fresh-ds")],
            dashboards=[_dashboard(name="甲面板", canvas_key="dashboard::org-a", directory_path="甲")],
        ),
        groups=[9],
        inherit_directory_groups=False,
    ).execute()
    assert created["success"] is True, created
    assert DataSourceAPIModel.objects.get(name="fresh-ds").groups == [4]
    assert Dashboard.objects.get(canvas_key="dashboard::org-a").groups == [4]

    _directory("乙", groups=[2])
    failed = _service(
        _doc(
            datasources=[_datasource(key="other::monitor/query", name="other-ds")],
            dashboards=[
                _dashboard(key="dashboard::a", name="面板甲", canvas_key="dashboard::pack-a", directory_path="甲"),
                _dashboard(key="dashboard::b", name="面板乙", canvas_key="dashboard::pack-b", directory_path="乙"),
            ],
        ),
        groups=[9],
    ).execute()
    assert ImportExportErrorCode.IMPORT_PACKAGE_ORG_DIVERGED in _codes(failed)
    assert not DataSourceAPIModel.objects.filter(name="other-ds").exists()
    assert Dashboard.objects.filter(canvas_key__in=["dashboard::pack-a", "dashboard::pack-b"]).count() == 0


@pytest.mark.django_db
def test_prefer_existing_looks_up_undeclared_datasource_in_the_target_database():
    directory = _directory("交付目录", groups=[4])
    existing = DataSourceAPIModel.objects.create(
        name="live-ds",
        rest_api="monitor/query",
        desc="local",
        groups=[4],
        created_by="local",
        updated_by="local",
    )
    item = _dashboard(
        canvas_key="dashboard::reuse-undeclared",
        directory_path="交付目录",
        view_sets=[{"valueConfig": {"dataSource": "live-ds::monitor/query"}}],
        refs={"datasource_keys": ["live-ds::monitor/query"]},
    )
    precheck = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[item])),
        conflict_policy="key_overwrite",
        datasource_resolve="prefer_existing",
    )
    assert precheck["valid"] is True, precheck["errors"]
    result = _service(_doc(dashboards=[item])).execute()
    assert result["success"] is True, result
    dashboard = Dashboard.objects.get(canvas_key="dashboard::reuse-undeclared")
    assert dashboard.view_sets[0]["valueConfig"]["dataSource"] == existing.id

    missing_item = _dashboard(
        name="缺源",
        canvas_key="dashboard::missing-ds",
        directory_path="交付目录",
        refs={"datasource_keys": ["absent::monitor/query"]},
    )
    missing_precheck = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[missing_item])),
        conflict_policy="key_overwrite",
    )
    assert missing_precheck["valid"] is False
    assert "未在YAML中声明" in missing_precheck["errors"][0]["message"]
    assert "目标环境中也不存在" in missing_precheck["errors"][0]["message"]
    missing = _service(_doc(dashboards=[missing_item])).execute()
    assert missing["success"] is False
    assert "未在YAML中声明" in _failed_messages(missing)
    assert "目标环境中也不存在" in _failed_messages(missing)

    package_mode = PrecheckService.precheck(
        yaml.safe_dump(_yaml_document(dashboards=[_dashboard(refs={"datasource_keys": ["live-ds::monitor/query"]})])),
        target_directory_id=directory.id,
    )
    assert package_mode["errors"][0]["code"] == ImportExportErrorCode.IMPORT_DEPENDENCY_MISSING
    assert "目标环境中也不存在" not in package_mode["errors"][0]["message"]


@pytest.mark.django_db
def test_canvas_unique_constraint_becomes_business_error(monkeypatch):
    _directory("交付目录")

    def raise_key(**kwargs):
        raise IntegrityError("UNIQUE constraint failed: operation_analysis_dashboard.canvas_key")

    monkeypatch.setattr(Dashboard.objects, "create", raise_key)
    raced = _service(_doc(dashboards=[_dashboard(canvas_key="dashboard::race", directory_path="交付目录")])).execute()
    assert raced["success"] is False
    assert ImportExportErrorCode.IMPORT_CANVAS_KEY_TAKEN in _codes(raced)

    def raise_name(**kwargs):
        raise IntegrityError("UNIQUE constraint failed: operation_analysis_dashboard.name")

    monkeypatch.setattr(Dashboard.objects, "create", raise_name)
    named = _service(_doc(dashboards=[_dashboard(name="撞名", canvas_key="dashboard::race-name", directory_path="交付目录")])).execute()
    assert ImportExportErrorCode.IMPORT_CANVAS_NAME_TAKEN in _codes(named)
