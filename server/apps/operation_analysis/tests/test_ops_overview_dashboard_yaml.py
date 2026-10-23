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
    widget_ids = {widget["id"] for widget in widgets}
    assert widget_ids >= TIME_BOUND_WIDGET_IDS | {
        "ops-kpi-resources",
        "ops-kpi-severe",
        "ops-app-total",
        "ops-app-with-alert",
        "ops-app-without-alert",
        "ops-monitor-ring",
    }
    assert "ops-app-ring" not in widget_ids
    assert "ops-collect-ring" not in widget_ids
    assert "ops-resource-total" not in widget_ids
    assert "ops-collect-configured" not in widget_ids
    assert "ops-collect-missing" not in widget_ids
    overview_text = SAMPLE_PATH.read_text(encoding="utf-8")
    assert "uncollected_instance_count" not in overview_text
    assert "collected_instance_share" not in overview_text
    assert "uncollected_instance_share" not in overview_text
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
    assert by_id["ops-kpi-resources"]["valueConfig"]["singleStyle"] == {
        "showIcon": True,
        "iconSource": "builtin",
        "iconKey": "cc-default",
    }
    assert by_id["ops-kpi-monitor"]["valueConfig"]["singleStyle"]["iconKey"] == "mm-monitor"
    assert by_id["ops-kpi-open-alerts"]["valueConfig"]["singleStyle"]["iconKey"] == "cc-security-equipment"
    assert by_id["ops-kpi-severe"]["valueConfig"]["singleStyle"]["iconKey"] == "icons/cc-security-equipment_安全设备"
    assert by_id["ops-kpi-resources"]["valueConfig"]["selectedFields"] == ["instance_count"]
    assert by_id["ops-app-total"]["valueConfig"]["chartType"] == "single"
    assert by_id["ops-app-total"]["valueConfig"]["dataSource"] == "关联告警汇总::monitor/get_cmdb_relation_alert_aggregation"
    assert by_id["ops-app-total"]["valueConfig"]["selectedFields"] == ["total_count"]
    assert by_id["ops-app-with-alert"]["valueConfig"]["descriptionField"] == "with_alert_share"
    assert by_id["ops-app-without-alert"]["valueConfig"]["descriptionField"] == "without_alert_share"
    assert by_id["ops-resource-types"]["w"] == 4
    assert by_id["ops-resource-types"]["x"] == 0
    assert by_id["ops-app-total"]["x"] == 4
    assert by_id["ops-app-total"]["w"] == 4
    assert by_id["ops-app-with-alert"]["x"] == by_id["ops-app-total"]["x"]
    assert by_id["ops-app-without-alert"]["x"] == by_id["ops-app-total"]["x"]
    assert by_id["ops-app-top"]["x"] == 8
    assert by_id["ops-app-top"]["w"] == 4
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
    assert by_id["ops-gauge-cpu"]["name"] == "主机 CPU 使用率"
    assert by_id["ops-gauge-memory"]["name"] == "主机内存使用率"
    assert by_id["ops-gauge-disk"]["name"] == "主机磁盘使用率"
    assert by_id["ops-app-top"]["valueConfig"]["chartType"] == "table"
    assert [column["key"] for column in by_id["ops-app-top"]["valueConfig"]["tableConfig"]["columns"]] == [
        "name",
        "alert_count",
        "share",
    ]
    monitor_columns = by_id["ops-monitor-alerts"]["valueConfig"]["tableConfig"]["columns"]
    assert [column["key"] for column in monitor_columns] == [
        "monitor_instance_name",
        "metric_name",
        "value",
        "level",
    ]
    assert monitor_columns[3]["title"] == "状态"
    assert monitor_columns[3]["cellType"] == "colorBackground"
    assert any(item["value"] == "critical" and item["result"]["text"] == "严重" for item in monitor_columns[3]["valueMappings"])
    alert_columns = by_id["ops-alert-top"]["valueConfig"]["tableConfig"]["columns"]
    assert [column["key"] for column in alert_columns] == [
        "resource_name",
        "title",
        "level",
        "created_at",
    ]
    assert alert_columns[2]["cellType"] == "colorBackground"
    assert any(item["value"] == "严重" and item["result"]["color"] == "#F43B2C" for item in alert_columns[2]["valueMappings"])
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
    by_key = {item.key: item for item in document.datasources}

    def field_keys(datasource_key):
        return {field["key"] for field in by_key[datasource_key].field_schema}

    assert {"with_alert_share", "without_alert_share"} <= field_keys("关联告警汇总::monitor/get_cmdb_relation_alert_aggregation")
    assert "share" in field_keys("关联告警 TOP::monitor/get_cmdb_relation_alert_aggregation")
    cmdb_fields = field_keys("模型/实例/分类总数统计::cmdb/get_cmdb_statistics")
    assert {"collected_instance_count", "collect_coverage_rate", "instance_count"} <= cmdb_fields
    assert "uncollected_instance_count" not in cmdb_fields
    assert "collected_instance_share" not in cmdb_fields
    assert "uncollected_instance_share" not in cmdb_fields
    assert {"value", "metric_name"} <= field_keys("监控活跃告警::monitor/query_latest_active_alerts")
