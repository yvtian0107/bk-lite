"""监控通用查询。过滤、统计、排序和分页在监控模块内完成。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from django.db.models import Count

from apps.monitor.services.generic_query_limits import (
    ALERT_RANGE_MAX_SECONDS,
    DETAIL_PAGE_SIZE_MAX,
    METRIC_INSTANCE_MAX,
    METRIC_POINTS_MAX,
    METRIC_SERIES_MAX,
    NATS_MESSAGE_MAX_BYTES,
    STAT_GROUP_MAX,
)
from apps.monitor.services.metrics import Metrics

INSTANCE_MODES = ("detail", "count", "distribution")
METRIC_MODES = ("series", "value")
ALERT_MODES = ("detail", "count", "distribution")
INSTANCE_FILTER_FIELDS = {"name", "ip", "cmdb_id"}
INSTANCE_GROUP_FIELDS = {"status", "is_active", "cloud_region_id"}
ALERT_TIME_FIELDS = {"start_event_time", "end_event_time", "created_at", "updated_at"}
ALERT_GROUP_FIELDS = {"level", "status", "alert_type", "monitor_instance_id"}
ALERT_SORT_FIELDS = {
    "start_event_time",
    "end_event_time",
    "created_at",
    "updated_at",
    "level",
    "status",
    "monitor_instance_name",
}


class GenericQueryError(Exception):
    def __init__(self, message: str, *, status: str = "failed"):
        super().__init__(message)
        self.message = message
        self.status = status


def ensure_payload_limit(data: Any) -> None:
    encoded = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
    if len(encoded) > NATS_MESSAGE_MAX_BYTES:
        raise GenericQueryError("结果超过 NATS 消息上限 1MB")


def query_instances(
    queryset,
    *,
    analysis_mode: str,
    status: str | None = None,
    filter_field: str | None = None,
    filter_op: str | None = None,
    filter_value=None,
    instance_ids=None,
    group_by: str | None = None,
    order: str | None = None,
    page=None,
    page_size=None,
) -> dict:
    mode = _mode(analysis_mode, INSTANCE_MODES)
    if mode != "detail":
        _reject_paging(page, page_size)
    queryset = _filter_instances(queryset, status, filter_field, filter_op, filter_value, instance_ids)
    if mode == "count":
        return _value(queryset.count(), unit="个", aggregation="监控实例计数")
    if mode == "distribution":
        field = group_by or "status"
        if field not in INSTANCE_GROUP_FIELDS:
            raise GenericQueryError("分组字段不受支持")
        if field == "status":
            grouped = queryset.values("is_active").annotate(value=Count("id"))
            group_count = grouped.count()
            _ensure_groups(group_count)
            items = [
                {
                    "name": "active" if row["is_active"] else "inactive",
                    "value": row["value"],
                }
                for row in grouped
            ]
        else:
            grouped = queryset.values(field).annotate(value=Count("id"))
            _ensure_groups(grouped.count())
            items = [{"name": "" if row[field] is None else str(row[field]), "value": row["value"]} for row in grouped]
        if not items:
            return {"structure": "category", "status": "empty", "items": [], "unit": "个", "aggregation": f"按 {field} 计数"}
        return {"structure": "category", "status": "ok", "items": items, "unit": "个", "aggregation": f"按 {field} 计数"}
    page_no, size = _parse_page(page, page_size)
    order_field = _order(order, {"name", "ip", "cmdb_id", "is_active", "id"}, default="name")
    total = queryset.count()
    rows = [_instance_row(item) for item in queryset.order_by(order_field)[(page_no - 1) * size : page_no * size]]
    return _table(rows, total, page_no, size)


def validate_metric_request(*, instance_ids, time_range, step) -> dict:
    ids = _id_list(instance_ids)
    if not ids:
        raise GenericQueryError("实例范围不能为空")
    if len(ids) > METRIC_INSTANCE_MAX:
        raise GenericQueryError(f"指标查询实例超过 {METRIC_INSTANCE_MAX} 个")
    if step in (None, ""):
        raise GenericQueryError("步长不能为空")
    try:
        step_seconds = Metrics.parse_step_to_seconds(step)
    except ValueError as exc:
        raise GenericQueryError("步长格式错误") from exc
    start, end = _parse_range(time_range)
    points = (end - start).total_seconds() / step_seconds
    if points > METRIC_POINTS_MAX:
        raise GenericQueryError("单条序列超过 500 个点，请缩短时间范围或加大步长")
    return {
        "instance_ids": ids,
        "start": start,
        "end": end,
        "step": str(step),
        "points": points,
    }


def build_metric_result(*, mode: str, response: dict, unit: str, aggregation: str, requested_ids: list[str]) -> dict:
    if not isinstance(response, dict) or response.get("status") != "success":
        message = ""
        if isinstance(response, dict):
            message = str(response.get("error") or response.get("message") or "")
        raise GenericQueryError(message or "指标查询失败")
    result = ((response.get("data") or {}).get("result")) or []
    if len(result) > METRIC_SERIES_MAX:
        raise GenericQueryError(f"返回序列超过 {METRIC_SERIES_MAX} 条")
    series_payload = {}
    seen_ids = set()
    numbers = []
    for index, series in enumerate(result):
        values = series.get("values") or []
        if len(values) > METRIC_POINTS_MAX:
            raise GenericQueryError("单条序列超过 500 个点，请缩短时间范围或加大步长")
        labels = series.get("metric") or {}
        instance_id = str(labels.get("instance_id") or labels.get("bk_inst_id") or "")
        if instance_id:
            seen_ids.add(instance_id)
        name = instance_id or f"series-{index + 1}"
        points = []
        for sample in values:
            if not isinstance(sample, (list, tuple)) or len(sample) < 2:
                continue
            raw = sample[1]
            if raw in (None, "NaN", "nan", ""):
                numeric = None
            else:
                try:
                    numeric = float(raw)
                except (TypeError, ValueError):
                    numeric = None
            if numeric is not None:
                numbers.append(numeric)
            points.append(
                {
                    "name": _epoch_name(sample[0]),
                    "value": numeric,
                    "instance_id": instance_id,
                    "unit": unit,
                    "aggregation": aggregation,
                    "status": "missing" if numeric is None else "ok",
                }
            )
        series_payload[name] = points
    missing = [item for item in requested_ids if item not in seen_ids]
    if mode == "value":
        if not numbers:
            return {
                "structure": "value",
                "status": "missing",
                "value": None,
                "unit": unit,
                "aggregation": aggregation,
                "unbound_instance_ids": missing,
            }
        reduced = _reduce(numbers, aggregation)
        return {
            "structure": "value",
            "status": "ok",
            "value": reduced,
            "unit": unit,
            "aggregation": aggregation,
            "unbound_instance_ids": missing,
        }
    if not series_payload:
        return {
            "structure": "series",
            "status": "missing",
            "unit": unit,
            "aggregation": aggregation,
            "series": {},
            "unbound_instance_ids": missing or requested_ids,
        }
    for points in series_payload.values():
        for point in points:
            point["unbound_instance_ids"] = missing
    return series_payload


def query_alerts(
    queryset,
    *,
    analysis_mode: str,
    level: str | None = None,
    status: str | None = None,
    alert_type: str | None = None,
    instance_id: str | None = None,
    time_field: str | None = None,
    time_range=None,
    group_by: str | None = None,
    order: str | None = None,
    page=None,
    page_size=None,
) -> dict:
    mode = _mode(analysis_mode, ALERT_MODES)
    if mode != "detail":
        _reject_paging(page, page_size)
    queryset = _filter_alerts(queryset, level, status, alert_type, instance_id, time_field, time_range)
    if mode == "count":
        return _value(queryset.count(), unit="条", aggregation="监控告警计数")
    if mode == "distribution":
        field = group_by or "level"
        if field not in ALERT_GROUP_FIELDS:
            raise GenericQueryError("分组字段不受支持")
        grouped = queryset.values(field).annotate(value=Count("id"))
        _ensure_groups(grouped.count())
        items = [{"name": "" if row[field] is None else str(row[field]), "value": row["value"]} for row in grouped]
        if not items:
            return {"structure": "category", "status": "empty", "items": [], "unit": "条", "aggregation": f"按 {field} 计数"}
        return {"structure": "category", "status": "ok", "items": items, "unit": "条", "aggregation": f"按 {field} 计数"}
    page_no, size = _parse_page(page, page_size)
    order_field = _order(order, ALERT_SORT_FIELDS, default="-start_event_time")
    total = queryset.count()
    rows = [_alert_row(item) for item in queryset.order_by(order_field)[(page_no - 1) * size : page_no * size]]
    return _table(rows, total, page_no, size)


def _filter_instances(queryset, status, field, op, value, instance_ids):
    if status in ("active", "inactive"):
        queryset = queryset.filter(is_active=(status == "active"))
    elif status not in (None, "", "all"):
        raise GenericQueryError("实例状态不受支持")
    ids = _id_list(instance_ids) if instance_ids not in (None, "", []) else []
    if ids:
        queryset = queryset.filter(id__in=ids)
    if field in (None, "") and value in (None, ""):
        return queryset
    if field not in INSTANCE_FILTER_FIELDS or op not in {"eq", "contains"} or value in (None, ""):
        raise GenericQueryError("属性过滤不受支持")
    lookup = field if op == "eq" else f"{field}__icontains"
    return queryset.filter(**{lookup: value})


def _filter_alerts(queryset, level, status, alert_type, instance_id, time_field, time_range):
    if level not in (None, ""):
        queryset = queryset.filter(level=level)
    if status not in (None, ""):
        queryset = queryset.filter(status=status)
    if alert_type not in (None, ""):
        queryset = queryset.filter(alert_type=alert_type)
    if instance_id not in (None, ""):
        queryset = queryset.filter(monitor_instance_id=str(instance_id))
    if time_range in (None, "", [], {}):
        if time_field not in (None, ""):
            raise GenericQueryError("时间范围不能为空")
        return queryset
    if time_field not in ALERT_TIME_FIELDS:
        raise GenericQueryError("时间字段不受支持")
    start, end = _parse_range(time_range)
    if (end - start).total_seconds() > ALERT_RANGE_MAX_SECONDS:
        raise GenericQueryError("监控告警时间范围最长 90 天")
    return queryset.filter(**{f"{time_field}__gte": start, f"{time_field}__lt": end})


def _instance_row(instance) -> dict:
    cmdb_id = instance.cmdb_id or ""
    return {
        "instance_id": instance.id,
        "name": instance.name,
        "ip": instance.ip or "",
        "cmdb_id": cmdb_id,
        "cmdb_bind_status": "bound" if cmdb_id else "unbound",
        "monitor_object_id": str(instance.monitor_object_id),
        "is_active": instance.is_active,
        "status": "active" if instance.is_active else "inactive",
    }


def _alert_row(alert) -> dict:
    return {
        "id": alert.id,
        "monitor_instance_id": alert.monitor_instance_id,
        "monitor_instance_name": alert.monitor_instance_name,
        "level": alert.level,
        "status": alert.status,
        "alert_type": alert.alert_type,
        "value": alert.value,
        "start_event_time": _iso(alert.start_event_time),
        "end_event_time": _iso(alert.end_event_time),
        "created_at": _iso(alert.created_at),
        "updated_at": _iso(alert.updated_at),
    }


def _value(value, *, unit: str, aggregation: str) -> dict:
    return {"structure": "value", "status": "ok", "value": value, "unit": unit, "aggregation": aggregation}


def _table(rows, total, page, page_size) -> dict:
    return {
        "structure": "table",
        "status": "empty" if total == 0 else "ok",
        "items": rows,
        "count": total,
        "page": page,
        "page_size": page_size,
    }


def _reduce(numbers: list[float], aggregation: str):
    op = str(aggregation or "avg").lower()
    if op == "sum":
        return sum(numbers)
    if op == "min":
        return min(numbers)
    if op == "max":
        return max(numbers)
    if op in {"avg", "average"}:
        return sum(numbers) / len(numbers)
    raise GenericQueryError("聚合方式不受支持")


def _mode(value, allowed) -> str:
    mode = str(value or "").strip()
    if mode not in allowed:
        raise GenericQueryError("分析方式不受支持")
    return mode


def _ensure_groups(count: int) -> None:
    if count > STAT_GROUP_MAX:
        raise GenericQueryError(f"统计分组超过 {STAT_GROUP_MAX} 组")


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


def _id_list(value) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    raise GenericQueryError("实例范围格式错误")


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
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
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


def _epoch_name(value) -> str:
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return str(value)


def _as_int(value, name: str) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError
        return int(value)
    except (TypeError, ValueError) as exc:
        raise GenericQueryError(f"{name} 必须是整数") from exc
