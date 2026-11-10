"""CMDB 通用查询 NATS handler。过滤、统计、排序和分页在 CMDB 内完成。"""

import nats_client
from apps.cmdb.nats.nats import _build_nats_model_permission_map, _build_nats_permission_map, _resolve_nats_cmdb_language
from apps.cmdb.services.asset_overview_query import list_model_association_options
from apps.cmdb.services.classification import ClassificationManage
from apps.cmdb.services.generic_query import (
    GenericQueryError,
    build_attribute_filter,
    ensure_payload_limit,
    load_start_instances,
    query_instances,
    query_models,
    query_one_hop_relations,
)
from apps.cmdb.services.generic_query_graph import GenericQueryGraphError, count_by_attr, query_one_hop
from apps.cmdb.services.generic_query_limits import ONE_HOP_START_MAX
from apps.cmdb.services.model import ModelManage
from apps.core.logger import cmdb_logger as logger


def _ok(data: dict) -> dict:
    ensure_payload_limit(data)
    return {"result": True, "data": data, "message": ""}


def _fail(message: str, status: str = "failed") -> dict:
    return {"result": False, "data": {"status": status}, "message": message}


def _guard(stage: str):
    def decorate(func):
        def wrapped(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except GenericQueryError as exc:
                return _fail(exc.message, exc.status)
            except GenericQueryGraphError as exc:
                return _fail(exc.message, "failed")
            except Exception as exc:
                logger.exception(
                    "event=cmdb_generic_query_failed failed_stage=%s error_type=%s",
                    stage,
                    type(exc).__name__,
                )
                return _fail("查询失败", "failed")

        wrapped.__name__ = func.__name__
        return wrapped

    return decorate


def _text_list(value) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    raise GenericQueryError("列表参数格式错误")


def _visible_models(user_info):
    language = _resolve_nats_cmdb_language(user_info)
    model_permissions = _build_nats_model_permission_map(user_info)
    instance_permissions = _build_nats_permission_map(user_info)
    if model_permissions is None or instance_permissions is None:
        raise GenericQueryError("无权限", status="forbidden")
    models = ModelManage.search_model(language=language, permissions_map=model_permissions) or []
    classifications = ClassificationManage.search_model_classification(language=language) or []
    names = {str(item.get("classification_id")): item.get("classification_name") or "" for item in classifications if item.get("classification_id")}
    visible = []
    for model in models:
        row = dict(model)
        row["classification_name"] = names.get(str(row.get("classification_id") or ""), "")
        visible.append(row)
    return visible, instance_permissions, names


def _attr_types(model_id: str, user_info) -> dict[str, str]:
    language = _resolve_nats_cmdb_language(user_info)
    try:
        attrs = ModelManage.search_model_attr(model_id, language=language) or []
    except Exception as exc:
        raise GenericQueryError("指定模型不存在或无权访问", status="forbidden") from exc
    types = {"inst_name": "string", "inst_uuid": "string"}
    for attr in attrs:
        attr_id = str(attr.get("attr_id") or "").strip()
        if attr_id:
            types[attr_id] = str(attr.get("attr_type") or "string")
    return types


@nats_client.register
@_guard("query_cmdb_models")
def query_cmdb_models(
    analysis_mode=None,
    classification_id=None,
    model_id=None,
    model_ids=None,
    result_op=None,
    result_value=None,
    order=None,
    page=None,
    page_size=None,
    user_info=None,
    **kwargs,
):
    """CMDB 模型查询。kwargs 接收运营分析透传的未知参数，不因此报错。"""
    del kwargs
    models, instance_permissions, names = _visible_models(user_info)
    if classification_id and str(classification_id) not in names:
        raise GenericQueryError("指定分类不存在或无权访问", status="forbidden")
    selected = _text_list(model_ids)
    if model_id not in (None, ""):
        selected.append(str(model_id))
    counts = count_by_attr("model_id", [], instance_permissions)
    data = query_models(
        models=models,
        instance_counts=counts,
        analysis_mode=analysis_mode or "detail",
        classification_id=str(classification_id or ""),
        model_ids=selected,
        result_op=result_op,
        result_value=result_value,
        order=order,
        page=page,
        page_size=page_size,
    )
    return _ok(data)


@nats_client.register
@_guard("query_cmdb_instances")
def query_cmdb_instances(
    model_id=None,
    analysis_mode=None,
    filter_field=None,
    filter_op=None,
    filter_value=None,
    filters=None,
    group_by=None,
    aggregate_field=None,
    aggregate_op=None,
    order=None,
    page=None,
    page_size=None,
    user_info=None,
    **kwargs,
):
    del kwargs
    _models, instance_permissions, _names = _visible_models(user_info)
    visible_ids = {str(item.get("model_id")) for item in _models}
    if str(model_id or "") not in visible_ids:
        raise GenericQueryError("指定模型不存在或无权访问", status="forbidden")
    data = query_instances(
        model_id=str(model_id),
        analysis_mode=analysis_mode or "detail",
        attr_types=_attr_types(str(model_id), user_info),
        permission_map=instance_permissions,
        filter_field=filter_field,
        filter_op=filter_op,
        filter_value=filter_value,
        filters=filters if isinstance(filters, list) else None,
        group_by=group_by,
        aggregate_field=aggregate_field,
        aggregate_op=aggregate_op,
        order=order,
        page=page,
        page_size=page_size,
    )
    return _ok(data)


@nats_client.register
@_guard("query_cmdb_one_hop")
def query_cmdb_one_hop(
    start_model_id=None,
    model_asst_id=None,
    direction=None,
    filter_field=None,
    filter_op=None,
    filter_value=None,
    end_filter_field=None,
    end_filter_op=None,
    end_filter_value=None,
    analysis_mode=None,
    order=None,
    page=None,
    page_size=None,
    user_info=None,
    **kwargs,
):
    del kwargs
    if not start_model_id or not model_asst_id or not direction:
        raise GenericQueryError("起点模型、关系和方向不能为空")
    models, instance_permissions, _names = _visible_models(user_info)
    visible_ids = {str(item.get("model_id")) for item in models}
    if str(start_model_id) not in visible_ids:
        raise GenericQueryError("指定模型不存在或无权访问", status="forbidden")
    language = _resolve_nats_cmdb_language(user_info)
    associations = list_model_association_options(language, start_model_id)
    association = next((item for item in associations if item.get("model_asst_id") == model_asst_id), None)
    if association is None:
        raise GenericQueryError("关系不存在或无权访问", status="forbidden")
    if direction == "out" and association.get("src_model_id") != start_model_id:
        raise GenericQueryError("关系方向与起点模型不一致")
    if direction == "in" and association.get("dst_model_id") != start_model_id:
        raise GenericQueryError("关系方向与起点模型不一致")
    if direction not in {"out", "in"}:
        raise GenericQueryError("关系方向不受支持")
    end_model_id = association.get("dst_model_id") if direction == "out" else association.get("src_model_id")
    if str(end_model_id) not in visible_ids:
        raise GenericQueryError("终点模型不存在或无权访问", status="forbidden")
    attr_types = _attr_types(str(start_model_id), user_info)
    params = []
    start_filter = build_attribute_filter(attr_types, filter_field, filter_op, filter_value)
    if start_filter:
        params.append(start_filter)
    _preview, total = load_start_instances(
        model_id=str(start_model_id),
        params=params,
        permission_map=instance_permissions,
        page=1,
        page_size=1,
    )
    if int(total or 0) > ONE_HOP_START_MAX:
        raise GenericQueryError(f"一跳关联起点超过 {ONE_HOP_START_MAX} 个")
    starts, _count = (
        ([], 0)
        if not total
        else load_start_instances(
            model_id=str(start_model_id),
            params=params,
            permission_map=instance_permissions,
            page=1,
            page_size=int(total),
        )
    )
    start_uuids = [str(item.get("inst_uuid")) for item in starts or [] if item.get("inst_uuid")]
    end_types = _attr_types(str(end_model_id), user_info) if end_filter_field else {}
    if end_filter_field:
        build_attribute_filter(end_types, end_filter_field, end_filter_op or "eq", end_filter_value)
    graph_result = query_one_hop(
        start_uuids=start_uuids,
        model_asst_id=str(model_asst_id),
        direction=direction,
        end_model_id=str(end_model_id),
        end_field=end_filter_field,
        end_op=end_filter_op or "eq",
        end_value=end_filter_value,
    )
    data = query_one_hop_relations(
        analysis_mode=analysis_mode or "detail",
        start_instances=starts or [],
        start_total=int(total or 0),
        graph_result=graph_result,
        order=order,
        page=page,
        page_size=page_size,
    )
    return _ok(data)


@nats_client.register
@_guard("list_cmdb_model_options")
def list_cmdb_model_options(classification_id=None, user_info=None, **kwargs):
    del kwargs
    models, _permissions, _names = _visible_models(user_info)
    if classification_id:
        models = [item for item in models if str(item.get("classification_id")) == str(classification_id)]
    data = [
        {
            "model_id": item.get("model_id"),
            "model_name": item.get("model_name") or item.get("model_id"),
            "classification_id": item.get("classification_id") or "",
        }
        for item in models
        if item.get("model_id")
    ]
    ensure_payload_limit(data)
    return {"result": True, "data": data, "message": ""}


@nats_client.register
@_guard("list_cmdb_attr_options")
def list_cmdb_attr_options(model_id=None, user_info=None, **kwargs):
    del kwargs
    if not model_id:
        raise GenericQueryError("模型不能为空")
    models, _permissions, _names = _visible_models(user_info)
    if str(model_id) not in {str(item.get("model_id")) for item in models}:
        raise GenericQueryError("指定模型不存在或无权访问", status="forbidden")
    language = _resolve_nats_cmdb_language(user_info)
    attrs = ModelManage.search_model_attr(str(model_id), language=language) or []
    data = [
        {
            "attr_id": attr.get("attr_id"),
            "attr_name": attr.get("attr_name") or attr.get("attr_id"),
            "attr_type": attr.get("attr_type") or "string",
        }
        for attr in attrs
        if attr.get("attr_id")
    ]
    ensure_payload_limit(data)
    return {"result": True, "data": data, "message": ""}
