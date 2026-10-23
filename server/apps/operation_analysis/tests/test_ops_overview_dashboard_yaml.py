"""运维总览内置画布：复用已有数据源，组织筛选与时间后缀跟其他 WeOpsX 画布一致。"""

from pathlib import Path

import yaml

from apps.operation_analysis.management.commands.init_builtin_canvases import (
    WEOPSX_OPS_OVERVIEW_YAML_PATH,
    YAML_FILE_PATH,
    _get_builtin_canvas_file_paths,
)
from apps.operation_analysis.schemas.import_export_schema import YAMLDocument

SUPPORT_DIR = Path(__file__).resolve().parents[1] / "support-files"
SAMPLE_PATH = SUPPORT_DIR / "weopsx_ops_overview_dashboard.yaml"

TIME_BOUND_WIDGET_IDS = {
    "ops-gauge-cpu",
    "ops-gauge-memory",
    "ops-gauge-disk",
    "ops-alert-trend",
}
TIME_SUFFIX_WIDGET_IDS = {"ops-alert-trend"}


def _load_sample():
    return yaml.safe_load(SAMPLE_PATH.read_text(encoding="utf-8"))


def _iter_widgets(view_sets):
    for item in view_sets:
        if item.get("itemType") == "group":
            yield from (item.get("subGridOpts") or {}).get("children") or []
        else:
            yield item


def test_ops_overview_yaml_is_loaded_as_builtin():
    assert SAMPLE_PATH.exists()
    assert Path(WEOPSX_OPS_OVERVIEW_YAML_PATH).resolve() == SAMPLE_PATH.resolve()
    loaded = {Path(path).resolve() for path in _get_builtin_canvas_file_paths()}
    assert SAMPLE_PATH.resolve() in loaded
    builtin = yaml.safe_load(Path(YAML_FILE_PATH).read_text(encoding="utf-8"))
    builtin_keys = {item["key"] for item in builtin.get("dashboards") or []}
    assert "dashboard::运维总览_内置" not in builtin_keys


def test_ops_overview_yaml_binds_organization_time_and_reusable_widgets():
    document = YAMLDocument(**_load_sample())
    dashboard = document.dashboards[0]
    assert dashboard.name == "运维总览"
    assert dashboard.key == "dashboard::运维总览_内置"
    filters = {item["key"]: item for item in dashboard.filters}
    assert set(filters) == {"organization", "time"}
    assert (filters["organization"].get("inputConfig") or {}).get("control") == "organization"
    assert filters["time"]["defaultValue"]["selectValue"] == 10080

    widgets = list(_iter_widgets(dashboard.view_sets))
    assert {widget["id"] for widget in widgets} >= TIME_BOUND_WIDGET_IDS | {
        "ops-kpi-resources",
        "ops-kpi-severe",
        "ops-collect-ring",
        "ops-app-total",
        "ops-monitor-ring",
    }
    assert "ops-app-ring" not in {widget["id"] for widget in widgets}
    for widget in widgets:
        value_config = widget["valueConfig"]
        assert value_config["filterBindings"]["organization__string"] is True
        bound_time = value_config["filterBindings"].get("time__timeRange") is True
        assert bound_time == (widget["id"] in TIME_BOUND_WIDGET_IDS)
        if widget["id"] in TIME_SUFFIX_WIDGET_IDS:
            assert widget["name"].endswith("（$time$）")
        else:
            assert not str(widget["name"]).endswith("（$time$）")
        org_param = next(param for param in value_config["dataSourceParams"] if param["name"] == "organization")
        assert (org_param.get("inputConfig") or {}).get("control") == "organization"

    by_id = {widget["id"]: widget for widget in widgets}
    assert by_id["ops-kpi-severe"]["valueConfig"]["selectedFields"] == ["severe_active_count"]
    assert by_id["ops-app-total"]["valueConfig"]["chartType"] == "pie"
    assert by_id["ops-app-total"]["valueConfig"]["dataSource"] == "关联告警分布::monitor/get_cmdb_relation_alert_aggregation"
    assert by_id["ops-app-total"]["h"] == by_id["ops-collect-ring"]["h"]
    assert by_id["ops-app-total"]["w"] == by_id["ops-collect-ring"]["w"]
    assert by_id["ops-collect-ring"]["valueConfig"]["pieScalarFields"] == [
        {"field": "collected_instance_count", "label": "已配置采集"},
        {"field": "uncollected_instance_count", "label": "未配置采集"},
    ]
    assert by_id["ops-monitor-ring"]["valueConfig"]["pieScalarFields"][0]["field"] == "monitor_instance_active"
    assert by_id["ops-gauge-cpu"]["valueConfig"]["compare"] is True
    assert by_id["ops-gauge-cpu"]["valueConfig"]["selectedFields"] == ["avg_cpu"]
    assert by_id["ops-gauge-memory"]["valueConfig"]["selectedFields"] == ["avg_memory"]
    assert by_id["ops-gauge-disk"]["valueConfig"]["selectedFields"] == ["avg_disk"]
    scope = next(param for param in by_id["ops-gauge-cpu"]["valueConfig"]["dataSourceParams"] if param["name"] == "scope")
    assert scope["value"] == "all_authorized"
    assert [param["type"] for param in by_id["ops-gauge-cpu"]["valueConfig"]["dataSourceParams"] if param["type"] in {"timeRange", "dateRange"}] == [
        "timeRange"
    ]
    assert by_id["ops-alert-trend"]["valueConfig"]["dataSourceParams"]
    trend_params = {param["name"]: param["value"] for param in by_id["ops-alert-trend"]["valueConfig"]["dataSourceParams"]}
    assert trend_params["bucket"] == "day"
    assert trend_params["series"] == "open_close"
    assert by_id["ops-resource-types"]["valueConfig"]["chartType"] == "topN"
    assert by_id["ops-resource-types"]["valueConfig"]["topNLabelField"] == "classification_name"
    assert by_id["ops-resource-types"]["valueConfig"]["topNValueField"] == "value"
    assert by_id["ops-resource-types"]["valueConfig"]["interaction"]["name"] == "查看全部"
    assert by_id["ops-monitor-ring"]["name"] == "监控接入概况"
    assert by_id["ops-gauge-cpu"]["name"] == "CPU 使用率"
    assert [column["key"] for column in by_id["ops-monitor-alerts"]["valueConfig"]["tableConfig"]["columns"]] == [
        "monitor_instance_name",
        "content",
        "level",
        "start_event_time",
    ]
    assert [column["key"] for column in by_id["ops-alert-top"]["valueConfig"]["tableConfig"]["columns"]] == [
        "resource_name",
        "title",
        "level",
        "created_at",
    ]
    assert by_id["ops-kpi-resources"]["valueConfig"]["interaction"]["url"] == "/cmdb/assetOverview"
    assert by_id["ops-app-top"]["valueConfig"]["interaction"]["name"] == "查看全部"
    assert {widget["valueConfig"]["dataSource"] for widget in widgets} <= set(dashboard.refs.datasource_keys)


def test_ops_overview_survives_builtin_merge():
    from apps.operation_analysis.management.commands.init_builtin_canvases import (
        _get_builtin_canvas_file_paths,
        _load_source_api_document,
        _merge_yaml_documents,
    )

    documents = [_load_source_api_document()]
    for file_path in _get_builtin_canvas_file_paths():
        documents.append(yaml.safe_load(Path(file_path).read_text(encoding="utf-8")))
    merged = _merge_yaml_documents(documents)
    document = YAMLDocument(**merged)
    dashboard = next(item for item in document.dashboards if item.key == "dashboard::运维总览_内置")
    available = {item.key for item in document.datasources}
    assert set(dashboard.refs.datasource_keys) <= available
    relation_keys = {item.key for item in document.datasources if item.rest_api == "monitor/get_cmdb_relation_alert_aggregation"}
    assert relation_keys == {
        "关联告警汇总::monitor/get_cmdb_relation_alert_aggregation",
        "关联告警分布::monitor/get_cmdb_relation_alert_aggregation",
        "关联告警 TOP::monitor/get_cmdb_relation_alert_aggregation",
    }
