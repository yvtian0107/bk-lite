import json
from types import SimpleNamespace

import pytest
from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from django.core.management.base import CommandError

from apps.operation_analysis.common.demo_source import (
    ACCEPTANCE_DATASOURCE_SPECS,
    ACCEPTANCE_MARK,
    ACCEPTANCE_TAG_IDS,
    CHART_TYPES,
    DEFAULT_NAMESPACE_NAME,
    REST_CASCADE_CHART,
    REST_INSTANCES,
    REST_METRICS,
    REST_METRICS_B,
    REST_MONITOR_OBJECTS,
    get_demo_source_data,
)
from apps.operation_analysis.models.datasource_models import DataSourceAPIModel, DataSourceTag, NameSpace
from apps.operation_analysis.views import datasource_view


def _items(payload):
    assert payload["result"] is True
    data = payload["data"]
    assert isinstance(data, dict)
    assert isinstance(data["items"], list)
    return data["items"]


def _ids(payload):
    return [item["id"] for item in _items(payload)]


def test_monitor_objects_are_fixed_and_ignore_params():
    payload = get_demo_source_data("accept_monitor_objects", {"object_id": "obj-a"})
    assert _items(payload) == [
        {"id": "obj-a", "name": "对象A"},
        {"id": "obj-b", "name": "对象B"},
    ]


@pytest.mark.parametrize(
    "params",
    [{}, {"object_id": ""}, {"object_id": "   "}, {"object_id": None}, {"object_id": []}],
)
def test_metrics_empty_object_id_returns_empty_list(params):
    assert _ids(get_demo_source_data("accept_metrics", params)) == []
    assert _ids(get_demo_source_data("accept_metrics_b", params)) == []


def test_metrics_filter_by_object_and_keep_a_separate_universe():
    assert _items(get_demo_source_data("accept_metrics", {"object_id": "obj-a"})) == [
        {"id": "m1", "name": "指标1"},
        {"id": "m2", "name": "指标2"},
    ]
    assert _ids(get_demo_source_data("accept_metrics", {"object_id": " obj-b "})) == ["m3"]
    assert _ids(get_demo_source_data("accept_metrics", {"object_id": "missing"})) == []

    assert _items(get_demo_source_data("accept_metrics_b", {"object_id": "obj-a"})) == [
        {"id": "mb1", "name": "指标B1"},
        {"id": "mb2", "name": "指标B2"},
    ]
    assert _ids(get_demo_source_data("accept_metrics_b", {"object_id": "obj-b"})) == ["mb3"]
    assert _ids(get_demo_source_data("accept_metrics", {"object_id": "obj-a"})) != _ids(
        get_demo_source_data("accept_metrics_b", {"object_id": "obj-a"})
    )


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"object_id": "obj-a"},
        {"metric_id": "m1"},
        {"object_id": "", "metric_id": "m1"},
        {"object_id": "obj-a", "metric_id": ""},
        {"object_id": "obj-a", "metric_id": "mb1"},
    ],
)
def test_instances_missing_or_unknown_combo_returns_empty_list(params):
    assert _ids(get_demo_source_data("accept_instances", params)) == []


def test_instances_filter_by_object_and_metric():
    assert _items(get_demo_source_data("accept_instances", {"object_id": "obj-a", "metric_id": "m1"})) == [
        {"id": "inst-a1", "name": "实例A1"},
        {"id": "inst-a1b", "name": "实例A1-2"},
    ]
    assert _ids(get_demo_source_data("accept_instances", {"object_id": "obj-a", "metric_id": " m2 "})) == ["inst-a2"]
    assert _ids(get_demo_source_data("accept_instances", {"object_id": "obj-b", "metric_id": "m3"})) == ["inst-b3"]


def test_cascade_chart_returns_one_illustrative_row():
    items = _items(
        get_demo_source_data(
            "accept_cascade_chart",
            {"object_id": "obj-a", "metric_id": "m1", "instance_id": "inst-a1"},
        )
    )
    assert items == [
        {
            "name": "级联示意",
            "value": 1,
            "object_id": "obj-a",
            "metric_id": "m1",
            "instance_id": "inst-a1",
        }
    ]
    assert len(_items(get_demo_source_data("accept_cascade_chart", {}))) == 1


def test_unknown_demo_path_returns_none():
    assert get_demo_source_data("accept_missing", {}) is None
    assert get_demo_source_data("accept_metrics", None)["result"] is True


def _spec(rest_api):
    return next(item for item in ACCEPTANCE_DATASOURCE_SPECS if item["rest_api"] == rest_api)


def test_seed_specs_use_chinese_names_and_point_chart_filters_at_demo_rest_apis():
    by_rest = {item["rest_api"]: item for item in ACCEPTANCE_DATASOURCE_SPECS}
    assert by_rest[REST_MONITOR_OBJECTS]["name"] == "验收·监控对象（选项）"
    assert by_rest[REST_MONITOR_OBJECTS]["params"] == []
    assert [item["name"] for item in by_rest[REST_METRICS]["params"]] == ["object_id"]
    assert [item["name"] for item in by_rest[REST_INSTANCES]["params"]] == ["object_id", "metric_id"]
    assert [item["name"] for item in by_rest[REST_METRICS_B]["params"]] == ["object_id"]
    assert all(item["desc"].startswith(ACCEPTANCE_MARK) for item in ACCEPTANCE_DATASOURCE_SPECS)

    chart = by_rest[REST_CASCADE_CHART]
    assert chart["name"] == "验收·级联指标图"
    assert chart["chart_type"] == CHART_TYPES
    assert {"line", "bar", "table", "single", "multiValue"} <= set(chart["chart_type"])
    for rest_api in (REST_MONITOR_OBJECTS, REST_METRICS, REST_INSTANCES, REST_METRICS_B):
        assert by_rest[rest_api]["chart_type"] == []
        assert by_rest[rest_api]["tag_ids"] == ACCEPTANCE_TAG_IDS
    assert chart["tag_ids"] == ACCEPTANCE_TAG_IDS
    params = {item["name"]: item for item in chart["params"]}
    assert list(params) == ["object_id", "metric_id", "instance_id"]
    for name, rest_api in (
        ("object_id", REST_MONITOR_OBJECTS),
        ("metric_id", REST_METRICS),
        ("instance_id", REST_INSTANCES),
    ):
        param = params[name]
        assert param["type"] == "string"
        assert param["filterType"] == "filter"
        source = param["inputConfig"]["optionsSource"]
        assert source["sourceRef"] == {"type": "rest_api", "value": rest_api}
        assert source["valueField"] == "id"
        assert source["labelField"] == "name"
    assert params["metric_id"]["inputConfig"]["optionsSource"]["queryParams"] == {"object_id": {"ref": "object_id"}}
    assert params["instance_id"]["inputConfig"]["optionsSource"]["queryParams"] == {
        "object_id": {"ref": "object_id"},
        "metric_id": {"ref": "metric_id"},
    }


def _post(user, data):
    factory = APIRequestFactory()
    request = factory.post(
        "/operation_analysis/api/data_source/get_source_data/1/",
        data=data,
        format="json",
    )
    request.COOKIES["current_team"] = "1"
    force_authenticate(request, user=user)
    return request


def _install_demo_instance(monkeypatch, rest_api):
    spec = _spec(rest_api)

    def _get_object(self):
        return SimpleNamespace(
            id=1,
            name=spec["name"],
            groups=[1],
            is_build_in=False,
            rest_api=rest_api,
            source_type=DataSourceAPIModel.SOURCE_TYPE_NATS,
            params=spec["params"],
            namespaces=SimpleNamespace(all=lambda: []),
        )

    monkeypatch.setattr(datasource_view.DataSourceAPIModelViewSet, "get_object", _get_object)
    monkeypatch.setattr(
        datasource_view,
        "GetNatsData",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("demo 短路不应访问 NATS")),
    )


@pytest.mark.django_db
def test_get_source_data_demo_short_circuit_filters_without_nats(authenticated_user, monkeypatch):
    authenticated_user.is_superuser = True
    _install_demo_instance(monkeypatch, REST_METRICS)
    request = _post(authenticated_user, {"object_id": "obj-a"})

    response = datasource_view.DataSourceAPIModelViewSet.as_view({"post": "get_source_data"})(request, pk="1")
    response.render()
    payload = json.loads(response.rendered_content)

    assert response.status_code == status.HTTP_200_OK
    assert payload["result"] is True
    assert payload["data"]["warnings"] == []
    assert payload["data"]["data"]["items"] == [
        {"id": "m1", "name": "指标1"},
        {"id": "m2", "name": "指标2"},
    ]


@pytest.mark.django_db
def test_get_source_data_unknown_demo_path_is_not_found(authenticated_user, monkeypatch):
    authenticated_user.is_superuser = True
    monkeypatch.setattr(
        datasource_view.DataSourceAPIModelViewSet,
        "get_object",
        lambda self: SimpleNamespace(
            id=1,
            name="未知演示",
            groups=[1],
            is_build_in=False,
            rest_api="demo/accept_missing",
            source_type=DataSourceAPIModel.SOURCE_TYPE_NATS,
            params=[],
            namespaces=SimpleNamespace(all=lambda: []),
        ),
    )
    monkeypatch.setattr(
        datasource_view,
        "GetNatsData",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("未知 demo 路径不应访问 NATS")),
    )
    request = _post(authenticated_user, {})

    response = datasource_view.DataSourceAPIModelViewSet.as_view({"post": "get_source_data"})(request, pk="1")
    response.render()
    payload = json.loads(response.rendered_content)

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert payload["result"] is False
    assert payload["message"] == "演示数据源不存在"


def _seed_namespace_and_tags():
    namespace = NameSpace.objects.create(
        name=DEFAULT_NAMESPACE_NAME,
        account="admin",
        password="secret",
        domain="127.0.0.1:4222",
        created_by="system",
        updated_by="system",
    )
    tags = [
        DataSourceTag.objects.create(
            tag_id=tag_id,
            name={"monitor": "监控", "other": "其他"}[tag_id],
            build_in=True,
            created_by="system",
            updated_by="system",
        )
        for tag_id in ACCEPTANCE_TAG_IDS
    ]
    return namespace, tags


@pytest.mark.django_db
def test_seed_command_requires_default_namespace_and_tags():
    with pytest.raises(CommandError, match="默认命名空间"):
        call_command("seed_accept_cascade_option_datasources")
    assert DataSourceAPIModel.objects.filter(rest_api__startswith="demo/accept_").count() == 0

    NameSpace.objects.create(
        name=DEFAULT_NAMESPACE_NAME,
        account="admin",
        password="secret",
        domain="127.0.0.1:4222",
        created_by="system",
        updated_by="system",
    )
    with pytest.raises(CommandError, match="monitor"):
        call_command("seed_accept_cascade_option_datasources")
    assert DataSourceAPIModel.objects.filter(rest_api__startswith="demo/accept_").count() == 0


@pytest.mark.django_db
def test_seed_command_is_idempotent_and_not_builtin():
    from apps.system_mgmt.models.user import Group

    namespace, _tags = _seed_namespace_and_tags()
    call_command("seed_accept_cascade_option_datasources")
    first_ids = set(DataSourceAPIModel.objects.filter(rest_api__startswith="demo/accept_").values_list("id", flat=True))
    assert len(first_ids) == len(ACCEPTANCE_DATASOURCE_SPECS)

    metrics = DataSourceAPIModel.objects.get(rest_api=REST_METRICS)
    metrics.name = "被改过的名字"
    metrics.is_build_in = True
    metrics.build_in_key = "accept-cascade-should-clear"
    metrics.params = [{"name": "stale"}]
    metrics.save(update_fields=["name", "is_build_in", "build_in_key", "params", "updated_at"])

    call_command("seed_accept_cascade_option_datasources", group_ids=[7])
    second_ids = set(DataSourceAPIModel.objects.filter(rest_api__startswith="demo/accept_").values_list("id", flat=True))
    assert second_ids == first_ids

    by_rest = {item.rest_api: item for item in DataSourceAPIModel.objects.filter(rest_api__startswith="demo/accept_")}
    for spec in ACCEPTANCE_DATASOURCE_SPECS:
        row = by_rest[spec["rest_api"]]
        assert row.name == spec["name"]
        assert row.desc == spec["desc"]
        assert row.source_type == DataSourceAPIModel.SOURCE_TYPE_NATS
        assert row.params == spec["params"]
        assert row.chart_type == spec["chart_type"]
        assert row.field_schema == spec["field_schema"]
        assert row.is_build_in is False
        assert row.build_in_key is None
        assert row.groups == [7]
        assert list(row.namespaces.values_list("name", flat=True)) == [DEFAULT_NAMESPACE_NAME]
        assert list(row.tag.order_by("tag_id").values_list("tag_id", flat=True)) == sorted(ACCEPTANCE_TAG_IDS)

    chart = by_rest[REST_CASCADE_CHART]
    assert set(chart.chart_type) >= {"line", "bar", "table", "single", "multiValue"}
    for rest_api in (REST_MONITOR_OBJECTS, REST_METRICS, REST_INSTANCES, REST_METRICS_B):
        assert by_rest[rest_api].chart_type == []

    chart.namespaces.clear()
    chart.tag.clear()
    call_command("seed_accept_cascade_option_datasources")
    chart.refresh_from_db()
    assert list(chart.namespaces.values_list("id", flat=True)) == [namespace.id]
    assert set(chart.tag.values_list("tag_id", flat=True)) == set(ACCEPTANCE_TAG_IDS)

    call_command("seed_accept_cascade_option_datasources")
    kept = DataSourceAPIModel.objects.get(rest_api=REST_CASCADE_CHART)
    assert kept.groups == [7]
    assert DataSourceAPIModel.objects.filter(rest_api__startswith="demo/accept_").count() == len(ACCEPTANCE_DATASOURCE_SPECS)

    default, _created = Group.objects.get_or_create(name="Default", parent_id=0)
    DataSourceAPIModel.objects.filter(rest_api=REST_MONITOR_OBJECTS).update(groups=[])
    call_command("seed_accept_cascade_option_datasources")
    refilled = DataSourceAPIModel.objects.get(rest_api=REST_MONITOR_OBJECTS)
    assert refilled.groups == [default.id]
    untouched = DataSourceAPIModel.objects.get(rest_api=REST_METRICS)
    assert untouched.groups == [7]
