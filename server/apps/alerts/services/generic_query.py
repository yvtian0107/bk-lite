"""告警中心通用查询。告警和事件分开统计，过滤与分组在数据库内完成。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from django.db.models import Count

from apps.alerts.services.generic_query_limits import DETAIL_PAGE_SIZE_MAX, NATS_MESSAGE_MAX_BYTES, RANGE_MAX_SECONDS, STAT_GROUP_MAX

QUERY_OBJECTS = {"alert", "event"}
MODES = ("detail", "count", "distribution")
ALERT_TIME_FIELDS = {"created_at", "updated_at", "first_event_time", "last_event_time", "closed_at"}
EVENT_TIME_FIELDS = {"received_at", "start_time", "end_time"}
ALERT_GROUP_FIELDS = {"level", "status", "source_name"}
EVENT_GROUP_FIELDS = {"level", "status", "source_id"}
ALERT_SORT_FIELDS = ALERT_TIME_FIELDS | {"level", "status", "alert_id"}
EVENT_SORT_FIELDS = EVENT_TIME_FIELDS | {"level", "status", "event_id"}


class GenericQueryError(Exception):
    def __init__(self, message: str, *, status: str = "failed"):
        super().__init__(message)
        self.message = message
        self.status = status


def ensure_payload_limit(data: Any) -> None:
    encoded = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
    if len(encoded) > NATS_MESSAGE_MAX_BYTES:
        raise GenericQueryError("结果超过 NATS 消息上限 1MB")


def query_alert_center(
    queryset,
    *,
    query_object: str,
    analysis_mode: str,
    source: str | None = None,
    level: str | None = None,
    status: str | None = None,
    time_field: str | None = None,
    time_range=None,
    group_by: str | None = None,
    order: str | None = None,
    page=None,
    page_size=None,
) -> dict:
    target = str(query_object or "").strip()
    if target not in QUERY_OBJECTS:
        raise GenericQueryError("查询对象必须是告警或事件")
    mode = str(analysis_mode or "").strip()
    if mode not in MODES:
        raise GenericQueryError("分析方式不受支持")
    if mode != "detail":
        _reject_paging(page, page_size)
    if time_range in (None, "", [], {}):
        raise GenericQueryError("时间范围不能为空")
    time_fields = ALERT_TIME_FIELDS if target == "alert" else EVENT_TIME_FIELDS
    if time_field not in time_fields:
        raise GenericQueryError("时间字段不受支持")
    start, end = _parse_range(time_range)
    if (end - start).total_seconds() > RANGE_MAX_SECONDS:
        raise GenericQueryError("告警中心时间范围最长 90 天")
    queryset = queryset.filter(**{f"{time_field}__gte": start, f"{time_field}__lt": end})
    if level not in (None, ""):
        queryset = queryset.filter(level=level)
    if status not in (None, ""):
        queryset = queryset.filter(status=status)
    if source not in (None, ""):
        if target == "event":
            queryset = queryset.filter(source__source_id=str(source))
        else:
            queryset = queryset.filter(events__source__source_id=str(source)).distinct()
    if mode == "count":
        return _value(queryset.count(), unit="条", aggregation=f"{_label(target)}计数")
    if mode == "distribution":
        fields = ALERT_GROUP_FIELDS if target == "alert" else EVENT_GROUP_FIELDS
        field = group_by or "level"
        if field not in fields:
            raise GenericQueryError("分组字段不受支持")
        grouped = queryset.values(field).annotate(value=Count("id"))
        if grouped.count() > STAT_GROUP_MAX:
            raise GenericQueryError(f"统计分组超过 {STAT_GROUP_MAX} 组")
        items = [{"name": "" if row[field] is None else str(row[field]), "value": row["value"]} for row in grouped]
        if not items:
            return {
                "structure": "category",
                "status": "empty",
                "items": [],
                "unit": "条",
                "aggregation": f"按 {field} 计数",
                "query_object": target,
            }
        return {
            "structure": "category",
            "status": "ok",
            "items": items,
            "unit": "条",
            "aggregation": f"按 {field} 计数",
            "query_object": target,
        }
    page_no, size = _parse_page(page, page_size)
    sort_fields = ALERT_SORT_FIELDS if target == "alert" else EVENT_SORT_FIELDS
    order_text = _order(order, sort_fields, default=f"-{time_field}")
    total = queryset.count()
    rows = [_row(item, target) for item in queryset.order_by(order_text)[(page_no - 1) * size : page_no * size]]
    return {
        "structure": "table",
        "status": "empty" if total == 0 else "ok",
        "query_object": target,
        "items": rows,
        "count": total,
        "page": page_no,
        "page_size": size,
    }


def _row(item, target: str) -> dict:
    if target == "event":
        source = getattr(item, "source", None)
        return {
            "event_id": item.event_id,
            "title": item.title,
            "level": item.level,
            "status": item.status,
            "source_id": getattr(source, "source_id", "") or "",
            "source_name": getattr(source, "name", "") or "",
            "resource_id": item.resource_id or "",
            "resource_name": item.resource_name or "",
            "monitor_id": item.monitor_id or "",
            "cmdb_id": item.cmdb_id or "",
            "received_at": _iso(item.received_at),
            "start_time": _iso(item.start_time),
            "end_time": _iso(item.end_time),
        }
    return {
        "alert_id": item.alert_id,
        "title": item.title,
        "level": item.level,
        "status": item.status,
        "source_name": item.source_name or "",
        "resource_id": item.resource_id or "",
        "resource_name": item.resource_name or "",
        "resource_type": item.resource_type or "",
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
        "first_event_time": _iso(item.first_event_time),
        "last_event_time": _iso(item.last_event_time),
        "closed_at": _iso(item.closed_at),
    }


def _value(value, *, unit: str, aggregation: str) -> dict:
    return {"structure": "value", "status": "ok", "value": value, "unit": unit, "aggregation": aggregation}


def _label(target: str) -> str:
    return "告警" if target == "alert" else "事件"


def _reject_paging(page, page_size) -> None:
    if page not in (None, "") or page_size not in (None, ""):
        raise GenericQueryError("当前分析方式不支持分页")


def _parse_page(page, page_size) -> tuple[int, int]:
    page_no = 1 if page in (None, "") else _as_int(page, "page")
    size = 20 if page_size in (None, "") else _as_int(page_size, "page_size")
    if page_no < 1:
        raise GenericQueryError("page 必须大于 0")
    if size < 1 or size > DETAIL_PAGE_SIZE_MAX:
        raise GenericQueryError(f"每页最多 {DETAIL_PAGE_SIZE_MAX} 条")
    return page_no, size


def _order(order, allowed: set[str], *, default: str) -> str:
    text = str(order or "").strip() or default
    field = text[1:] if text.startswith("-") else text
    if field not in allowed:
        raise GenericQueryError(f"不支持的排序字段: {field}")
    return text


def _parse_range(value) -> tuple[datetime, datetime]:
    if isinstance(value, (list, tuple)) and len(value) == 2:
        start_raw, end_raw = value
    elif isinstance(value, dict) and value.get("start") and value.get("end"):
        start_raw, end_raw = value["start"], value["end"]
    else:
        raise GenericQueryError("时间范围格式错误")
    start = _parse_dt(start_raw)
    end = _parse_dt(end_raw)
    if start >= end:
        raise GenericQueryError("开始时间必须小于结束时间")
    return start, end


def _parse_dt(value) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value or "").strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise GenericQueryError("时间格式错误") from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _as_int(value, name: str) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError
        return int(value)
    except (TypeError, ValueError) as exc:
        raise GenericQueryError(f"{name} 必须是整数") from exc
