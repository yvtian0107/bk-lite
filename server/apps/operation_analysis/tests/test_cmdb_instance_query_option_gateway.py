import json
from pathlib import Path
from types import SimpleNamespace

from apps.cmdb.nats import nats
from apps.operation_analysis.views.datasource_view import _resolve_request_params

SOURCE_API = Path(__file__).parents[1] / "support-files" / "source_api.json"
USER_INFO = {"user": "alice", "team": 1}
PERMISSION = {1: {"inst_names": []}}
HOST = {"model_id": "host", "model_name": "主机", "classification_id": "host_manage"}
AWS = {"model_id": "aws_cf", "model_name": "AWS CloudFront分配", "classification_id": "aws"}
CLASSIFICATIONS = [
    {"classification_id": "host_manage", "classification_name": "逻辑主机"},
    {"classification_id": "aws", "classification_name": "AWS"},
]


def _spec(rest_api):
    sources = json.loads(SOURCE_API.read_text(encoding="utf-8"))
    return next(item for item in sources if item.get("rest_api") == rest_api)


def _resolve(rest_api, body):
    spec = _spec(rest_api)
    instance = SimpleNamespace(params=spec["params"], rest_api=rest_api)
    return _resolve_request_params(instance, body)


def _patch_catalog(monkeypatch, attrs=None):
    calls = {"search": [], "attrs": []}

    def search_model(**kwargs):
        calls["search"].append(kwargs)
        selected = kwargs.get("classification_ids") or []
        rows = [HOST, AWS]
        if selected:
            rows = [row for row in rows if row["classification_id"] in selected]
        return rows

    def search_attrs(model_id, language="zh-Hans"):
        calls["attrs"].append(model_id)
        if attrs is not None:
            return attrs
        return [{"attr_id": "inst_name", "attr_name": "名称", "attr_type": "str"}]

    monkeypatch.setattr(nats, "_build_nats_model_permission_map", lambda user_info: PERMISSION)
    monkeypatch.setattr(nats, "_build_nats_permission_map", lambda user_info, model_id="", **kwargs: PERMISSION)
    monkeypatch.setattr(nats.ClassificationManage, "search_model_classification", lambda *args, **kwargs: CLASSIFICATIONS)
    monkeypatch.setattr(nats.ModelManage, "search_model", search_model)
    monkeypatch.setattr(nats.ModelManage, "search_model_attr", search_attrs)
    return calls


def test_gateway_keeps_classification_until_the_model_handler(monkeypatch):
    calls = _patch_catalog(monkeypatch)
    resolved = _resolve("cmdb/get_model_options", {"classification_ids": ["host_manage"]})
    assert resolved["classification_ids"] == ["host_manage"]

    out = nats.get_model_options(user_info=USER_INFO, **resolved)

    assert out["result"] is True
    assert [row["model_id"] for row in out["data"]] == ["host"]
    assert calls["search"][0]["classification_ids"] == ["host_manage"]
    assert "aws_cf" not in [row["model_id"] for row in out["data"]]


def test_omitted_classification_lists_visible_models_without_selecting_one(monkeypatch):
    _patch_catalog(monkeypatch)
    resolved = _resolve("cmdb/get_model_options", {})
    assert resolved["classification_ids"] == []

    out = nats.get_model_options(user_info=USER_INFO, **resolved)

    assert out["result"] is True
    assert [row["model_id"] for row in out["data"]] == ["aws_cf", "host"]
    assert "selected" not in out


def test_classification_union_reaches_the_model_handler(monkeypatch):
    calls = _patch_catalog(monkeypatch)
    resolved = _resolve("cmdb/get_model_options", {"classification_ids": ["host_manage", "aws"]})

    out = nats.get_model_options(user_info=USER_INFO, **resolved)

    assert calls["search"][0]["classification_ids"] == ["host_manage", "aws"]
    assert [row["model_id"] for row in out["data"]] == ["aws_cf", "host"]


def test_gateway_forwards_field_catalog_scope_and_mode(monkeypatch):
    calls = _patch_catalog(monkeypatch)
    resolved = _resolve(
        "cmdb/get_instance_query_fields",
        {
            "classification_ids": ["host_manage"],
            "model_ids": ["host"],
            "analysis_mode": "distribution",
        },
    )
    assert resolved == {
        "classification_ids": ["host_manage"],
        "model_ids": ["host"],
        "analysis_mode": "distribution",
    }

    out = nats.get_instance_query_fields(user_info=USER_INFO, **resolved)

    assert out["result"] is True
    assert calls["attrs"] == ["host"]
    keys = {row["key"] for row in out["data"]}
    assert "group_value" in keys
    assert "count" in keys
    assert "inst_name" in keys
    assert all(row.get("model_id") in (None, "host") for row in out["data"])


def test_field_catalog_rejects_empty_model_before_expanding_attrs(monkeypatch):
    calls = _patch_catalog(monkeypatch)
    for model_ids in (None, [], "", ["", " "]):
        resolved = _resolve(
            "cmdb/get_instance_query_fields",
            {"classification_ids": ["host_manage"], "analysis_mode": "distribution"},
        )
        if model_ids is not None:
            resolved["model_ids"] = model_ids
        else:
            resolved.pop("model_ids", None)
        out = nats.get_instance_query_fields(user_info=USER_INFO, **resolved)
        assert out["result"] is False
        assert out["message"] == "请选择模型"
        assert out["data"] == []
    assert calls["search"] == []
    assert calls["attrs"] == []


def test_field_catalog_rejects_model_outside_classification_before_attrs(monkeypatch):
    calls = _patch_catalog(monkeypatch)
    resolved = _resolve(
        "cmdb/get_instance_query_fields",
        {
            "classification_ids": ["host_manage"],
            "model_ids": ["aws_cf"],
            "analysis_mode": "aggregate",
        },
    )

    out = nats.get_instance_query_fields(user_info=USER_INFO, **resolved)

    assert out["result"] is False
    assert "不属于所选分类" in out["message"]
    assert calls["attrs"] == []
