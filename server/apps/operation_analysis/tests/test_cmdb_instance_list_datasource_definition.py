import json
from pathlib import Path

SOURCE_API = Path(__file__).parents[1] / "support-files" / "source_api.json"


def _sources():
    return json.loads(SOURCE_API.read_text(encoding="utf-8"))


def test_cmdb_instance_query_is_one_source_for_four_modes():
    entries = _sources()
    matches = [item for item in entries if item.get("rest_api") == "cmdb/query_model_instances"]
    assert len(matches) == 1
    source = matches[0]

    assert source["key"] == "CMDB 实例查询::cmdb/query_model_instances"
    assert source["name"] == "CMDB 实例查询"
    assert source["chart_type"] == ["table", "single", "bar", "pie", "topN"]
    assert source["tag"] == ["cmdb"]
    assert "暂不支持" not in source["desc"]
    assert "实例数量" in source["desc"]
    assert "模型多选且必填" in source["desc"]
    assert "都空表示权限内全部模型" not in source["desc"]

    mode = next(item for item in source["params"] if item["name"] == "analysis_mode")
    assert mode["required"] is True
    assert mode["value"] == "list"
    assert [item["value"] for item in mode["inputConfig"]["optionsSource"]["staticItems"]] == [
        "list",
        "count",
        "distribution",
        "aggregate",
    ]

    classification = next(item for item in source["params"] if item["name"] == "classification_ids")
    model = next(item for item in source["params"] if item["name"] == "model_ids")
    assert classification.get("required") is not True
    assert model.get("required") is True
    assert model["inputConfig"]["multiple"] is True
    assert model["inputConfig"]["missingOptionPolicy"] == "retain"
    options = model["inputConfig"]["optionsSource"]
    assert options["sourceRef"] == {"type": "rest_api", "value": "cmdb/get_model_options"}
    assert options["labelField"] == "label"
    assert options["queryParams"]["classification_ids"] == {"ref": "classification_ids", "whenEmpty": "omit"}

    conditions = next(item for item in source["params"] if item["name"] == "conditions")
    assert conditions["inputConfig"]["control"] == "condition"
    group_by = next(item for item in source["params"] if item["name"] == "group_by")
    metrics = next(item for item in source["params"] if item["name"] == "metrics")
    assert group_by["visibleWhen"] == {"param": "analysis_mode", "in": ["distribution"]}
    assert metrics["visibleWhen"] == {"param": "analysis_mode", "in": ["aggregate"]}
    assert "model_id" not in [item["name"] for item in source["params"]]
    assert "scope_count" in [field["key"] for field in source["field_schema"]]
    assert all(item.get("rest_api") != "cmdb/list_model_instances" for item in entries)

    fields = next(item for item in entries if item.get("rest_api") == "cmdb/get_instance_query_fields")
    assert fields["chart_type"] == []
    assert {item["name"]: item["filterType"] for item in fields["params"]} == {
        "classification_ids": "params",
        "model_ids": "params",
        "analysis_mode": "params",
    }
    assert "空模型不会展开" in fields["desc"]


def test_instance_detail_source_is_not_force_retired():
    from apps.operation_analysis.management.commands.init_source_api_data import RETIRED_BUILTIN_DATASOURCES

    assert all(item["rest_api"] != "cmdb/list_model_instances" for item in RETIRED_BUILTIN_DATASOURCES)


def test_source_api_json_has_no_duplicate_keys():
    def reject_duplicate_keys(pairs):
        keys = [key for key, _value in pairs]
        duplicates = sorted({key for key in keys if keys.count(key) > 1})
        assert not duplicates, duplicates
        return dict(pairs)

    json.loads(SOURCE_API.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)


def test_cmdb_model_options_datasource_is_option_only():
    entries = _sources()
    source = next(item for item in entries if item.get("rest_api") == "cmdb/get_model_options")
    assert source["key"] == "CMDB 模型列表::cmdb/get_model_options"
    assert source["name"] == "CMDB 模型列表（选项）"
    assert source["chart_type"] == []
    assert source["params"][0]["name"] == "classification_ids"
    assert source["params"][0]["filterType"] == "params"
    assert source["params"][0]["value"] == []
    assert "空" in source["params"][0]["desc"]
    assert {field["key"] for field in source["field_schema"]} >= {"model_id", "model_name", "label"}


def test_existing_cmdb_list_sources_stay():
    rest_apis = {item.get("rest_api") for item in _sources()}
    assert "cmdb/get_room_list" in rest_apis
    assert "cmdb/list_application_systems" in rest_apis
    assert "cmdb/get_classification_model_instance_counts" in rest_apis


def test_targeted_rest_api_update_is_declared():
    from apps.operation_analysis.management.commands.init_source_api_data import Command

    parser = Command().create_parser("manage.py", "init_source_api_data")
    options = parser.parse_args(["--rest-api", "cmdb/query_model_instances"])
    assert options.rest_api == ["cmdb/query_model_instances"]
    assert options.force_update is False
