import json
from pathlib import Path

SOURCE_API = Path(__file__).parents[1] / "support-files" / "source_api.json"


def _sources():
    return json.loads(SOURCE_API.read_text(encoding="utf-8"))


def test_cmdb_instance_list_datasource_is_detail_table():
    entries = _sources()
    source = next(item for item in entries if item.get("rest_api") == "cmdb/list_model_instances")

    assert source["key"] == "CMDB 实例明细::cmdb/list_model_instances"
    assert source["name"] == "CMDB 实例明细"
    assert source["chart_type"] == ["table"]
    assert source["tag"] == ["cmdb"]

    model = next(item for item in source["params"] if item["name"] == "model_id")
    assert model["required"] is True
    assert model["value"] == ""
    assert model["filterType"] == "params"
    assert model["inputConfig"]["componentSwitch"] is True
    options = model["inputConfig"]["optionsSource"]
    assert options["sourceRef"] == {"type": "rest_api", "value": "cmdb/get_model_options"}
    assert options["valueField"] == "model_id"
    assert options["labelField"] == "model_name"

    names = [item["name"] for item in source["params"]]
    assert names == ["model_id", "attr_filters", "order", "page", "page_size", "organization"]
    assert next(item for item in source["params"] if item["name"] == "order")["value"] == "inst_name"
    assert {item["name"] for item in source["params"] if item["name"] in {"page", "page_size"}} == {"page", "page_size"}
    organization = next(item for item in source["params"] if item["name"] == "organization")
    assert organization["inputConfig"]["control"] == "organization"
    assert [field["key"] for field in source["field_schema"]] == ["inst_uuid", "inst_name", "model_id"]


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
