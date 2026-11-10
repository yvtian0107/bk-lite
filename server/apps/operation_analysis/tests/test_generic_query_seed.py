"""内置通用查询种子：分析方式、枚举和分页默认值。"""

import json
from pathlib import Path

from apps.alerts.constants.constants import AlertStatus, EventLevel, EventStatus
from apps.monitor.models.monitor_policy import MonitorAlert, MonitorEvent

SEED = Path(__file__).resolve().parents[1] / "support-files" / "source_api.json"


def _sources():
    data = json.loads(SEED.read_text(encoding="utf-8"))
    return {
        item["rest_api"]: item
        for item in data
        if item.get("key", "").endswith(f"::{item.get('rest_api')}")
        and item["rest_api"]
        in {
            "cmdb/query_cmdb_models",
            "cmdb/query_cmdb_instances",
            "cmdb/query_cmdb_one_hop",
            "monitor/query_monitor_instances",
            "monitor/query_monitor_metric",
            "monitor/query_monitor_alerts",
            "alert/query_alert_center",
        }
    }


def _param(source, name):
    return next(item for item in source["params"] if item["name"] == name)


def _option_values(param):
    return {item["value"] for item in param["inputConfig"]["optionsSource"]["staticItems"]}


def test_generic_query_seed_declares_analysis_modes_without_paging_defaults():
    sources = _sources()
    assert set(sources) == {
        "cmdb/query_cmdb_models",
        "cmdb/query_cmdb_instances",
        "cmdb/query_cmdb_one_hop",
        "monitor/query_monitor_instances",
        "monitor/query_monitor_metric",
        "monitor/query_monitor_alerts",
        "alert/query_alert_center",
    }
    for source in sources.values():
        mode = _param(source, "analysis_mode")
        assert "componentSwitch" not in mode.get("inputConfig", {})
        options = mode["inputConfig"]["optionsSource"]["staticItems"]
        assert options
        for option in options:
            assert option["charts"]
            assert option["result"]["structure"] in {"table", "value", "category", "series"}
            assert set(option["charts"]) <= set(source["chart_type"])
        if any(param["name"] == "page" for param in source["params"]):
            assert _param(source, "page")["value"] is None
            assert _param(source, "page_size")["value"] is None
            assert _param(source, "page")["visible_modes"] == ["detail"]


def test_generic_query_seed_enums_match_module_constants():
    sources = _sources()
    levels = _option_values(_param(sources["monitor/query_monitor_alerts"], "level"))
    assert levels <= {value for value, _label in MonitorEvent.LEVEL_CHOICES}
    statuses = _option_values(_param(sources["monitor/query_monitor_alerts"], "status"))
    assert statuses <= {value for value, _label in MonitorAlert.STATUS_CHOICES}
    alert_levels = _option_values(_param(sources["alert/query_alert_center"], "level"))
    assert alert_levels <= {value for value, _label in EventLevel.CHOICES}
    alert_statuses = _option_values(_param(sources["alert/query_alert_center"], "status"))
    allowed_status = {value for value, _label in EventStatus.CHOICES + AlertStatus.CHOICES}
    assert alert_statuses <= allowed_status
