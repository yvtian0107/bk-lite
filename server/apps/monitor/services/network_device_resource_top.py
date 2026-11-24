"""Network-device resource ranking aligned to professional monitor detail queries."""

import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from apps.monitor.services.metric_query_contract import AuthorizedMetricQueryError, build_instance_matcher_groups, join_label_queries
from apps.monitor.services.metric_series import MAX_INSTANCE_IDS
from apps.monitor.utils.dimension import parse_instance_id

SUPPORTED_METRIC_TYPES = ("cpu", "memory", "traffic")
NETWORK_DEVICE_TYPE_ID = "Network Device"
DETAIL_DEFAULT_WINDOW_MINUTES = 15
DETAIL_QUERY_CHUNK_SIZE = MAX_INSTANCE_IDS
DETAIL_METRIC_MANIFEST = Path(__file__).resolve().parent.parent / "support-files" / "network_device_detail_metrics.json"
DETAIL_METRIC_NAMES = frozenset(
    {
        "device_cpu_usage",
        "device_memory_usage",
        "device_total_incoming_traffic",
        "device_total_outgoing_traffic",
    }
)
METRIC_QUERY_NAMES = {
    "cpu": ("device_cpu_usage",),
    "memory": ("device_memory_usage",),
    "traffic": ("device_total_incoming_traffic", "device_total_outgoing_traffic"),
}


@dataclass(frozen=True)
class NetworkCandidate:
    instance_id: str
    value: Any
    sampled_at: datetime
    metric_type: str


@dataclass(frozen=True)
class NetworkDeviceDetailMetric:
    object_name: str
    metric_name: str
    capability_id: str
    template: str


def validate_metric_type(metric_type: str) -> str:
    normalized = str(metric_type or "").strip().lower()
    if normalized not in SUPPORTED_METRIC_TYPES:
        raise ValueError("metric_type 仅支持 cpu、memory、traffic")
    return normalized


def _aware(value):
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _monitor_object_type_id(monitor_object) -> str:
    if monitor_object is None:
        return ""
    if hasattr(monitor_object, "type_id"):
        type_id = monitor_object.type_id
        return "" if type_id in (None, "") else str(type_id)
    related_id = getattr(getattr(monitor_object, "type", None), "id", None)
    return "" if related_id in (None, "") else str(related_id)


def _is_network_device(meta) -> bool:
    return bool(meta) and meta.get("object_type_id") == NETWORK_DEVICE_TYPE_ID


def _instance_keys(instance) -> tuple[str, ...]:
    monitor_object = getattr(instance, "monitor_object", None)
    raw = getattr(monitor_object, "instance_id_keys", None) or ["instance_id"]
    keys = tuple(str(key).strip() for key in raw if str(key).strip())
    return keys or ("instance_id",)


def _logical_instance_id(instance) -> str:
    parsed = parse_instance_id(getattr(instance, "id", None))
    if not parsed or parsed[0] in (None, ""):
        return ""
    return str(parsed[0])


def _detail_window() -> str:
    from apps.monitor.services.dashboard_query_capabilities import _query_window

    return _query_window(0, DETAIL_DEFAULT_WINDOW_MINUTES * 60 * 1000)


def _chunks(values: list[str], size: int):
    step = max(1, int(size))
    for start in range(0, len(values), step):
        yield values[start : start + step]


@lru_cache(maxsize=1)
def load_network_device_detail_metrics() -> dict[tuple[str, str], NetworkDeviceDetailMetric]:
    from apps.monitor.services.dashboard_query_capabilities import load_dashboard_query_capabilities

    payload = json.loads(DETAIL_METRIC_MANIFEST.read_text(encoding="utf-8"))
    bindings_payload = payload.get("bindings")
    if payload.get("version") != 1 or not isinstance(bindings_payload, list):
        raise RuntimeError("invalid network device detail metric manifest")

    capabilities = load_dashboard_query_capabilities()
    bindings = {}
    for item in bindings_payload:
        if not isinstance(item, dict):
            raise RuntimeError("invalid network device detail metric")
        object_name = str(item.get("object_name") or "").strip()
        metric_name = str(item.get("metric_name") or "").strip()
        capability_id = str(item.get("capability_id") or "").strip()
        capability = capabilities.get(capability_id)
        key = (object_name, metric_name)
        if (
            not object_name
            or metric_name not in DETAIL_METRIC_NAMES
            or capability is None
            or object_name not in capability.object_names
            or key in bindings
        ):
            raise RuntimeError(f"invalid network device detail metric: {object_name}.{metric_name or '-'}")
        bindings[key] = NetworkDeviceDetailMetric(
            object_name=object_name,
            metric_name=metric_name,
            capability_id=capability_id,
            template=capability.template,
        )
    return bindings


def build_ranked_rows(candidates, device_meta, *, limit=10):
    ordered = sorted(
        candidates,
        key=lambda item: (-float(item.value), str(device_meta[item.instance_id].get("name") or item.instance_id), item.instance_id),
    )[:limit]
    rows = []
    for rank, item in enumerate(ordered, 1):
        meta = device_meta[item.instance_id]
        rows.append(
            {
                "rank": rank,
                "display_name": meta.get("name") or meta.get("ip") or item.instance_id,
                "ip": meta.get("ip") or "",
                "instance_id": item.instance_id,
                "device_type": meta.get("object_name"),
                "value": round(float(item.value), 2),
                "unit": "byteps" if item.metric_type == "traffic" else "percent",
                "sampled_at": item.sampled_at.isoformat(),
            }
        )
    return rows


class NetworkDeviceResourceTopService:
    def __init__(self, *, vm_api, now=None):
        self.vm_api = vm_api
        self.now = now

    def _query_instant(self, query: str, window: str, reference: datetime):
        try:
            response = self.vm_api.query(query, step=window, lookback_delta=window, time=reference.timestamp())
        except TypeError:
            response = self.vm_api.query(query)
        if not isinstance(response, dict) or response.get("status") != "success":
            raise RuntimeError("网络设备资源指标查询失败")
        result = response.get("data", {}).get("result", [])
        samples = []
        for series in result if isinstance(result, list) else []:
            labels = series.get("metric") or {}
            point = series.get("value")
            instance_id = str(labels.get("instance_id") or "")
            if not instance_id or not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            try:
                sampled_at = datetime.fromtimestamp(float(point[0]), tz=timezone.utc)
                value = float(point[1])
            except (TypeError, ValueError, OSError, OverflowError):
                continue
            if not math.isfinite(value):
                continue
            samples.append((instance_id, value, sampled_at))
        return samples

    def run(self, metric_type, authorized_instances, *, limit=10):
        metric_type = validate_metric_type(metric_type)
        if not 1 <= int(limit) <= 100:
            raise ValueError("limit 必须在 1 到 100 之间")
        reference = _aware(self.now) or datetime.now(timezone.utc)
        meta = {}
        for instance in authorized_instances:
            logical_id = _logical_instance_id(instance)
            if not logical_id:
                continue
            item = {
                "name": getattr(instance, "name", ""),
                "ip": getattr(instance, "ip", ""),
                "object_name": getattr(getattr(instance, "monitor_object", None), "name", ""),
                "object_type_id": _monitor_object_type_id(getattr(instance, "monitor_object", None)),
                "instance_keys": _instance_keys(instance),
            }
            if _is_network_device(item):
                meta[logical_id] = item
        if not meta:
            return []

        metric_names = METRIC_QUERY_NAMES[metric_type]
        bindings = load_network_device_detail_metrics()
        groups = {}
        for instance_id, item in meta.items():
            for metric_name in metric_names:
                binding = bindings.get((item["object_name"], metric_name))
                if binding is None:
                    continue
                group_key = (binding.capability_id, item["instance_keys"], metric_name)
                group = groups.get(group_key)
                if group is None:
                    groups[group_key] = {
                        "template": binding.template,
                        "keys": list(item["instance_keys"]),
                        "metric_name": metric_name,
                        "ids": [instance_id],
                    }
                else:
                    group["ids"].append(instance_id)
        if not groups:
            return []

        window = _detail_window()
        freshness = timedelta(minutes=DETAIL_DEFAULT_WINDOW_MINUTES)
        found = {metric_name: {} for metric_name in metric_names}
        for group in groups.values():
            metric_name = group["metric_name"]
            for chunk in _chunks(sorted(set(group["ids"])), DETAIL_QUERY_CHUNK_SIZE):
                try:
                    matchers = build_instance_matcher_groups(tuple(chunk), group["keys"])
                except AuthorizedMetricQueryError:
                    continue
                query = join_label_queries(group["template"], matchers).replace("__$window__", window)
                if "__$" in query:
                    raise RuntimeError("网络设备详情查询模板参数不完整")
                allowed = set(chunk)
                for instance_id, value, sampled_at in self._query_instant(query, window, reference):
                    if instance_id not in allowed:
                        continue
                    if reference - sampled_at > freshness:
                        continue
                    current = found[metric_name].get(instance_id)
                    if current is None or sampled_at > current[1]:
                        found[metric_name][instance_id] = (value, sampled_at)

        candidates = []
        if metric_type == "traffic":
            for instance_id in set().union(*(samples.keys() for samples in found.values())):
                parts = [found[metric_name][instance_id] for metric_name in metric_names if instance_id in found[metric_name]]
                if not parts:
                    continue
                candidates.append(
                    NetworkCandidate(
                        instance_id,
                        sum(value for value, _sampled_at in parts),
                        max(sampled_at for _value, sampled_at in parts),
                        metric_type,
                    )
                )
        else:
            metric_name = metric_names[0]
            for instance_id, (value, sampled_at) in found[metric_name].items():
                candidates.append(NetworkCandidate(instance_id, value, sampled_at, metric_type))
        return build_ranked_rows(candidates, meta, limit=int(limit))
