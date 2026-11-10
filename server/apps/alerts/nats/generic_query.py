"""告警中心通用查询 NATS handler。告警与事件不混用。"""

import nats_client
from apps.alerts.models.alert_source import AlertSource
from apps.alerts.models.models import Event
from apps.alerts.nats.nats import _get_authorized_alert_queryset
from apps.alerts.services.generic_query import GenericQueryError, ensure_payload_limit
from apps.alerts.services.generic_query import query_alert_center as run_alert_center_query
from apps.alerts.utils.permission_scope import apply_team_scope_with_group_ids
from apps.core.logger import alert_logger as logger
from apps.core.utils.viewset_utils import GenericViewSetFun


def _ok(data) -> dict:
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
            except Exception as exc:
                logger.exception(
                    "event=alert_generic_query_failed failed_stage=%s error_type=%s",
                    stage,
                    type(exc).__name__,
                )
                return _fail("查询失败", "failed")

        wrapped.__name__ = func.__name__
        return wrapped

    return decorate


def _event_queryset(user_info: dict):
    alerts, error = _get_authorized_alert_queryset(user_info)
    if error:
        message = error.get("message") or "无权限"
        status = "forbidden" if "权限" in message or "组织" in message or "用户" in message else "failed"
        raise GenericQueryError(message, status=status)
    team = (user_info or {}).get("team")
    team_ids = [int(team)]
    if (user_info or {}).get("include_children"):
        children = GenericViewSetFun.extract_child_group_ids((user_info or {}).get("group_tree", []), int(team))
        if children:
            team_ids = children
    # 事件口径独立：只取授权组织内的事件，不把告警行混进结果。
    return apply_team_scope_with_group_ids(Event.objects.select_related("source"), team_ids)


@nats_client.register
@_guard("query_alert_center")
def query_alert_center(
    query_object=None,
    analysis_mode=None,
    source=None,
    level=None,
    status=None,
    time_field=None,
    time_range=None,
    group_by=None,
    order=None,
    page=None,
    page_size=None,
    user_info=None,
    **kwargs,
):
    del kwargs
    target = str(query_object or "").strip()
    if target == "alert":
        queryset, error = _get_authorized_alert_queryset(user_info or {})
        if error:
            message = error.get("message") or "无权限"
            status_name = "forbidden" if message != "查询失败" else "failed"
            raise GenericQueryError(message, status=status_name)
    elif target == "event":
        queryset = _event_queryset(user_info or {})
    else:
        raise GenericQueryError("查询对象必须是告警或事件")
    data = run_alert_center_query(
        queryset,
        query_object=target,
        analysis_mode=analysis_mode or "detail",
        source=source,
        level=level,
        status=status,
        time_field=time_field,
        time_range=time_range,
        group_by=group_by,
        order=order,
        page=page,
        page_size=page_size,
    )
    return _ok(data)


@nats_client.register
@_guard("list_alert_source_options")
def list_alert_source_options(user_info=None, **kwargs):
    del kwargs
    _alerts, error = _get_authorized_alert_queryset(user_info or {})
    if error:
        raise GenericQueryError(error.get("message") or "无权限", status="forbidden")
    data = [{"source_id": item.source_id, "name": item.name} for item in AlertSource.objects.filter(is_active=True).order_by("name", "source_id")]
    ensure_payload_limit(data)
    return {"result": True, "data": data, "message": ""}
