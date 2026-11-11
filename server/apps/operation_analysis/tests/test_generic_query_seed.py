"""内置通用查询种子：分析方式、枚举和分页默认值。"""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

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


def test_generic_query_seed_declares_analysis_modes_and_paging_defaults():
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
        has_page = any(param["name"] == "page" for param in source["params"])
        if source["rest_api"] == "monitor/query_monitor_metric":
            assert has_page is False
        else:
            assert has_page is True
            assert _param(source, "page")["value"] == 1
            assert _param(source, "page_size")["value"] == 20
            assert _param(source, "page")["visible_modes"] == ["detail"]
            assert _param(source, "page_size")["visible_modes"] == ["detail"]


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

    center = sources["alert/query_alert_center"]

    def objects_for(param_name, value):
        item = next(option for option in _param(center, param_name)["inputConfig"]["optionsSource"]["staticItems"] if option["value"] == value)
        return set(item.get("query_objects") or ["alert", "event"])

    assert objects_for("status", "received") == {"event"}
    assert objects_for("status", "unassigned") == {"alert"}
    assert objects_for("status", "pending") == {"alert", "event"}
    assert objects_for("time_field", "created_at") == {"alert"}
    assert objects_for("time_field", "received_at") == {"event"}
    assert objects_for("group_by", "source_name") == {"alert"}
    assert objects_for("group_by", "source_id") == {"event"}
    assert objects_for("group_by", "level") == {"alert", "event"}


def test_generic_query_seed_uses_chart_driven_filters_and_order():
    sources = _sources()
    models = sources["cmdb/query_cmdb_models"]
    model = _param(models, "model_id")
    assert model["inputConfig"]["optionsSource"]["queryParams"]["classification_id"] == {"ref": "classification_id"}
    assert model["inputConfig"]["optionsSource"]["emptyUpstreamHintKey"] == "dashboard.selectClassificationFirst"
    for rest_api in (
        "cmdb/query_cmdb_models",
        "cmdb/query_cmdb_instances",
        "cmdb/query_cmdb_one_hop",
        "monitor/query_monitor_instances",
        "monitor/query_monitor_alerts",
        "alert/query_alert_center",
    ):
        source = sources[rest_api]
        modes = {item["value"]: item["charts"] for item in _param(source, "analysis_mode")["inputConfig"]["optionsSource"]["staticItems"]}
        assert "topN" not in modes["detail"]
        assert "topN" in modes["distribution"]
        assert _param(source, "order")["inputConfig"]["control"] == "order"
    assert _param(models, "result_filter")["inputConfig"]["control"] == "conditionFilter"
    assert "distribution" in _param(models, "result_filter")["visible_modes"]
    assert _param(models, "result_op")["hidden"] is True
    assert _param(sources["cmdb/query_cmdb_instances"], "filters")["inputConfig"]["fields"]["kind"] == "modelAttrs"
    assert _param(sources["cmdb/query_cmdb_one_hop"], "end_filters")["inputConfig"]["fields"]["kind"] == "endModelAttrs"
    assert _param(sources["alert/query_alert_center"], "filters")["type"] == "conditionFilter"
    metric = sources["monitor/query_monitor_metric"]
    assert all(param.get("type") != "conditionFilter" for param in metric["params"])


def test_instance_and_one_hop_classification_is_single_select_and_declared():
    from apps.operation_analysis.views.datasource_view import _resolve_request_params

    sources = _sources()
    specs = (
        ("cmdb/query_cmdb_instances", "model_id"),
        ("cmdb/query_cmdb_one_hop", "start_model_id"),
    )
    for rest_api, model_name in specs:
        source = sources[rest_api]
        classification = _param(source, "classification_id")
        options = classification["inputConfig"]["optionsSource"]
        assert classification["inputConfig"]["control"] == "select"
        assert classification["inputConfig"].get("multiple") is not True
        assert options["valueField"] == "classification_id"
        assert options["sourceRef"]["value"] == "cmdb/get_model_classification_options"
        model = _param(source, model_name)
        model_options = model["inputConfig"]["optionsSource"]
        assert model["inputConfig"].get("multiple") is not True
        assert model_options["queryParams"]["classification_id"] == {"ref": "classification_id"}
        assert model_options["emptyUpstreamHintKey"] == "dashboard.selectClassificationFirst"
        visible = [item["name"] for item in source["params"] if not item.get("hidden")]
        assert visible.index("classification_id") < visible.index(model_name)
        instance = SimpleNamespace(rest_api=rest_api, params=source["params"])
        resolved = _resolve_request_params(
            instance,
            {"classification_id": "compute", model_name: "host", "analysis_mode": "detail"},
        )
        assert resolved["classification_id"] == "compute"
        assert resolved[model_name] == "host"
        with pytest.raises(ValueError, match="未声明参数"):
            _resolve_request_params(instance, {"classification_id": "compute", "not_declared": "x"})

    one_hop = sources["cmdb/query_cmdb_one_hop"]
    visible = [item["name"] for item in one_hop["params"] if not item.get("hidden")]
    assert visible.index("classification_id") < visible.index("start_model_id") < visible.index("model_asst_id")
    assert "end_filter_field" not in visible
    assert "filter_field" not in visible
    association = _param(one_hop, "model_asst_id")["inputConfig"]["optionsSource"]
    assert association["queryParams"]["model_id"] == {"ref": "start_model_id"}
    assert _param(one_hop, "filters")["inputConfig"]["fields"]["kind"] == "modelAttrs"
    assert _param(one_hop, "end_filters")["inputConfig"]["fields"]["kind"] == "endModelAttrs"


def test_model_query_schema_matches_detail_rows_without_touching_other_status():
    sources = _sources()
    models = sources["cmdb/query_cmdb_models"]
    assert [field["key"] for field in models["field_schema"]] == [
        "classification_name",
        "model_name",
        "model_id",
        "instance_count",
    ]
    assert "按模型给出权限内实例数" in models["desc"]
    assert "分类汇总" not in models["desc"]
    alerts = sources["monitor/query_monitor_alerts"]
    center = sources["alert/query_alert_center"]
    assert "status" in {field["key"] for field in alerts["field_schema"]}
    assert "status" in {field["key"] for field in center["field_schema"]}
    instances = sources["monitor/query_monitor_instances"]
    assert "status" in {field["key"] for field in instances["field_schema"]}
    assert "unit" in {field["key"] for field in instances["field_schema"]}
