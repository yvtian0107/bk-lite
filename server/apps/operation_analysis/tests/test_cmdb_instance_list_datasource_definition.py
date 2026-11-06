import json
from pathlib import Path

SOURCE_API = Path(__file__).parents[1] / "support-files" / "source_api.json"


def _sources():
    return json.loads(SOURCE_API.read_text(encoding="utf-8"))


def test_cmdb_instance_query_is_one_table_source_with_analysis_mode():
    entries = _sources()
    matches = [item for item in entries if item.get("rest_api") == "cmdb/query_model_instances"]
    assert len(matches) == 1
    source = matches[0]

    assert source["key"] == "CMDB 实例查询::cmdb/query_model_instances"
    assert source["name"] == "CMDB 实例查询"
    assert source["chart_type"] == ["table"]
    assert source["tag"] == ["cmdb"]
    assert "list" in source["desc"]
    assert "count" in source["desc"]
    assert "distribution" in source["desc"]
    assert "暂不支持" in source["desc"]

    mode = next(item for item in source["params"] if item["name"] == "analysis_mode")
    assert mode["required"] is True
    assert mode["value"] == "list"
    assert mode["alias_name"] == "分析方式"
    assert mode["inputConfig"]["control"] == "select"
    assert "componentSwitch" not in mode["inputConfig"]
    assert mode["inputConfig"]["optionsSource"]["staticItems"] == [
        {"label": "明细", "value": "list"},
        {"label": "数量", "value": "count"},
        {"label": "属性分布", "value": "distribution"},
        {"label": "数值聚合", "value": "aggregate"},
    ]

    model = next(item for item in source["params"] if item["name"] == "model_id")
    assert model["required"] is True
    assert model["value"] == ""
    assert model["filterType"] == "params"
    assert model["inputConfig"]["control"] == "select"
    assert "componentSwitch" not in model["inputConfig"]
    options = model["inputConfig"]["optionsSource"]
    assert options["sourceRef"] == {"type": "rest_api", "value": "cmdb/get_model_options"}
    assert options["valueField"] == "model_id"
    assert options["labelField"] == "model_name"

    names = [item["name"] for item in source["params"]]
    assert names == [
        "analysis_mode",
        "model_id",
        "attr_filters",
        "group_by",
        "agg_field",
        "agg_func",
        "order",
        "page",
        "page_size",
        "organization",
    ]
    assert next(item for item in source["params"] if item["name"] == "order")["value"] == ""
    assert next(item for item in source["params"] if item["name"] == "group_by")["value"] == ""
    organization = next(item for item in source["params"] if item["name"] == "organization")
    assert organization["inputConfig"]["control"] == "organization"
    assert [field["key"] for field in source["field_schema"]] == [
        "inst_uuid",
        "inst_name",
        "model_id",
        "group_value",
        "count",
    ]
    assert all(item.get("rest_api") != "cmdb/list_model_instances" for item in entries)
    assert all(item.get("name") != "CMDB 实例明细" for item in entries)


def test_retired_instance_detail_source_is_deactivated_on_init():
    from apps.operation_analysis.management.commands.init_source_api_data import RETIRED_BUILTIN_DATASOURCES

    retired = next(item for item in RETIRED_BUILTIN_DATASOURCES if item["rest_api"] == "cmdb/list_model_instances")
    assert retired["build_in_key"] == "CMDB 实例明细::cmdb/list_model_instances"
    assert retired["name"] == "CMDB 实例明细"


def test_cmdb_model_options_datasource_is_option_only():
    entries = _sources()
    source = next(item for item in entries if item.get("rest_api") == "cmdb/get_model_options")
    assert source["key"] == "CMDB 模型列表::cmdb/get_model_options"
    assert source["name"] == "CMDB 模型列表（选项）"
    assert source["chart_type"] == []
    assert source["params"] == []
    assert {field["key"] for field in source["field_schema"]} == {"model_id", "model_name"}


def test_existing_cmdb_list_sources_stay():
    rest_apis = {item.get("rest_api") for item in _sources()}
    assert "cmdb/get_room_list" in rest_apis
    assert "cmdb/list_application_systems" in rest_apis
    assert "cmdb/get_classification_model_instance_counts" in rest_apis
