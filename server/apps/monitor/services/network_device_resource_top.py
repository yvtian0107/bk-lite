"""Network-device resource ranking aligned to professional monitor detail queries.

Devices with a professional detail formula reuse that PromQL. Raw sample age is a
separate gate: a series stays in the calculation only when its own timestamp is
within two collection intervals. The 15-minute detail window is only the rate
range, not that freshness gate. Devices without a detail formula keep the
previous raw-series average or sum.
"""

import json
import math
import re
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
DETAIL_RATE_WINDOW_SECONDS = DETAIL_DEFAULT_WINDOW_MINUTES * 60
DEFAULT_COLLECTION_INTERVAL_SECONDS = 300
DETAIL_QUERY_CHUNK_SIZE = MAX_INSTANCE_IDS
FALLBACK_METRIC_NAMES = {
    "cpu": ("device_cpu_usage",),
    "memory": ("device_memory_usage", "device_memory_used", "device_memory_free", "device_memory_total"),
    "traffic": ("device_total_incoming_traffic", "device_total_outgoing_traffic"),
}
_RATE_SELECTOR = re.compile(r"\b(?P<fn>rate|irate|increase|delta)\((?P<name>[A-Za-z_:][A-Za-z0-9_:]*)\{(?P<labels>[^{}]*)\}(?P<window>\[[^\]]+\])\)")
_INSTANT_SELECTOR = re.compile(r"(?<![\w:])(?P<name>[A-Za-z_:][A-Za-z0-9_:]*)\{(?P<labels>[^{}]*)\}")
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


def collection_interval_seconds(value) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return DEFAULT_COLLECTION_INTERVAL_SECONDS
    return number if number > 0 else DEFAULT_COLLECTION_INTERVAL_SECONDS


def freshness_cutoff_literal(reference: datetime, interval_seconds: int) -> str:
    cutoff = reference.timestamp() - 2 * interval_seconds
    if math.isfinite(cutoff) and float(cutoff).is_integer():
        return str(int(cutoff))
    return format(cutoff, ".6f").rstrip("0").rstrip(".")


def gate_raw_selectors(query: str, cutoff_literal: str) -> str:
    """Keep each raw series only when its own timestamp is at least the cutoff.

    The comparison uses timestamp(), not the aggregation result time. rate() keeps
    its range selector and then drops a series whose latest raw sample is older
    than the cutoff.
    """
    tokens = []

    def _hold(expression: str) -> str:
        tokens.append(expression)
        return f"@@GATE{len(tokens) - 1}@@"

    def _rate(match: re.Match) -> str:
        instant = f"{match.group('name')}{{{match.group('labels')}}}"
        return _hold(f"({match.group('fn')}({instant}{match.group('window')}) and ignoring(__name__) (timestamp({instant}) >= {cutoff_literal}))")

    gated = _RATE_SELECTOR.sub(_rate, query)

    def _instant(match: re.Match) -> str:
        instant = f"{match.group('name')}{{{match.group('labels')}}}"
        return _hold(f"({instant} and timestamp({instant}) >= {cutoff_literal})")

    gated = _INSTANT_SELECTOR.sub(_instant, gated)
    for index in range(len(tokens) - 1, -1, -1):
        gated = gated.replace(f"@@GATE{index}@@", tokens[index])
    return gated


def _logical_instance_id(instance) -> str:
    parsed = parse_instance_id(getattr(instance, "id", None))
    if not parsed or parsed[0] in (None, ""):
        return ""
    return str(parsed[0])


def _detail_window() -> str:
    from apps.monitor.services.dashboard_query_capabilities import _query_window

    return _query_window(0, DETAIL_RATE_WINDOW_SECONDS * 1000)


def _duration_literal(seconds: int) -> str:
    from apps.monitor.services.dashboard_query_capabilities import _format_duration

    return _format_duration(seconds)


def _search_window_seconds(metric_type: str, interval_seconds: int) -> int:
    freshness = 2 * interval_seconds
    if metric_type == "traffic":
        return max(DETAIL_RATE_WINDOW_SECONDS, freshness)
    return freshness


def _matcher_id(raw_id, logical_id: str, keys: tuple[str, ...]) -> str | None:
    if len(keys) <= 1:
        return logical_id
    parsed = parse_instance_id(raw_id)
    if len(parsed) < len(keys) or any(value in (None, "") for value in parsed[: len(keys)]):
        return None
    return str(raw_id)


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

    def _query_fallback(self, metric_name: str, logical_ids: list[str], window: str, reference: datetime):
        grouped = {}
        for chunk in _chunks(sorted(set(logical_ids)), DETAIL_QUERY_CHUNK_SIZE):
            try:
                matcher = build_instance_matcher_groups(tuple(chunk), ["instance_id"])[0][0]
            except AuthorizedMetricQueryError:
                continue
            query = f'{{__name__="{metric_name}",{matcher}}}'
            for instance_id, value, sampled_at in self._query_instant(query, window, reference):
                if instance_id not in set(chunk) or value < 0:
                    continue
                grouped.setdefault(instance_id, {}).setdefault(metric_name, []).append((value, sampled_at))
        return grouped

    def run(self, metric_type, authorized_instances, *, limit=10):
        metric_type = validate_metric_type(metric_type)
        if not 1 <= int(limit) <= 100:
            raise ValueError("limit 必须在 1 到 100 之间")
        reference = _aware(self.now) or datetime.now(timezone.utc)
        meta = {}
        devices = []
        for instance in authorized_instances:
            logical_id = _logical_instance_id(instance)
            if not logical_id:
                continue
            keys = _instance_keys(instance)
            item = {
                "name": getattr(instance, "name", ""),
                "ip": getattr(instance, "ip", ""),
                "object_name": getattr(getattr(instance, "monitor_object", None), "name", ""),
                "object_type_id": _monitor_object_type_id(getattr(instance, "monitor_object", None)),
                "instance_keys": keys,
                "interval": collection_interval_seconds(getattr(instance, "interval", None)),
            }
            if not _is_network_device(item):
                continue
            meta[logical_id] = item
            devices.append(
                {
                    "logical_id": logical_id,
                    "raw_id": getattr(instance, "id", logical_id),
                    "keys": keys,
                    "interval": item["interval"],
                    "object_name": item["object_name"],
                }
            )
        if not devices:
            return []

        metric_names = METRIC_QUERY_NAMES[metric_type]
        bindings = load_network_device_detail_metrics()
        groups = {}
        fallback = []
        for device in devices:
            matcher_id = _matcher_id(device["raw_id"], device["logical_id"], device["keys"])
            placed = False
            for metric_name in metric_names:
                binding = bindings.get((device["object_name"], metric_name))
                if binding is None or matcher_id is None:
                    continue
                placed = True
                group_key = (binding.capability_id, device["keys"], metric_name, device["interval"])
                group = groups.get(group_key)
                member = {"logical_id": device["logical_id"], "matcher_id": matcher_id}
                if group is None:
                    groups[group_key] = {
                        "template": binding.template,
                        "keys": list(device["keys"]),
                        "metric_name": metric_name,
                        "interval": device["interval"],
                        "members": [member],
                    }
                else:
                    group["members"].append(member)
            if not placed:
                fallback.append(device)

        rate_window = _detail_window()
        found = {metric_name: {} for metric_name in metric_names}
        for group in groups.values():
            metric_name = group["metric_name"]
            cutoff = freshness_cutoff_literal(reference, group["interval"])
            window = _duration_literal(_search_window_seconds(metric_type, group["interval"]))
            members = sorted({member["matcher_id"]: member for member in group["members"]}.values(), key=lambda item: item["matcher_id"])
            for chunk in _chunks(members, DETAIL_QUERY_CHUNK_SIZE):
                aliases = {member["logical_id"]: member["logical_id"] for member in chunk}
                aliases.update({member["matcher_id"]: member["logical_id"] for member in chunk})
                try:
                    matchers = build_instance_matcher_groups(tuple(member["matcher_id"] for member in chunk), group["keys"])
                except AuthorizedMetricQueryError:
                    failed_ids = {member["logical_id"] for member in chunk}
                    for samples in found.values():
                        for logical_id in failed_ids:
                            samples.pop(logical_id, None)
                    fallback.extend(device for device in devices if device["logical_id"] in failed_ids and device not in fallback)
                    continue
                query = join_label_queries(group["template"], matchers).replace("__$window__", rate_window)
                if "__$" in query:
                    raise RuntimeError("网络设备详情查询模板参数不完整")
                query = gate_raw_selectors(query, cutoff)
                for instance_id, value, sampled_at in self._query_instant(query, window, reference):
                    logical_id = aliases.get(instance_id)
                    if logical_id is None:
                        continue
                    current = found[metric_name].get(logical_id)
                    if current is None or sampled_at > current[1]:
                        found[metric_name][logical_id] = (value, sampled_at)

        candidates = _candidates_from_detail(found, metric_names, metric_type)
        if fallback:
            candidates.extend(self._fallback_candidates(metric_type, fallback, reference))
        return build_ranked_rows(candidates, meta, limit=int(limit))

    def _fallback_candidates(self, metric_type: str, devices: list[dict], reference: datetime):
        logical_ids = [device["logical_id"] for device in devices]
        window = _duration_literal(max(2 * device["interval"] for device in devices))
        grouped = {}
        for metric_name in FALLBACK_METRIC_NAMES[metric_type]:
            for instance_id, metrics in self._query_fallback(metric_name, logical_ids, window, reference).items():
                grouped.setdefault(instance_id, {}).update(metrics)
        intervals = {device["logical_id"]: device["interval"] for device in devices}
        return _aggregate_fallback(metric_type, grouped, intervals, reference)


def _fresh(samples, reference: datetime, interval_seconds: int):
    limit = timedelta(seconds=2 * interval_seconds)
    return [item for item in samples if reference - item[1] <= limit]


def _aggregate_fallback(metric_type: str, grouped: dict, intervals: dict[str, int], reference: datetime):
    candidates = []
    for instance_id, by_metric in grouped.items():
        interval = intervals[instance_id]

        def fresh(name, _interval=interval):
            return _fresh(by_metric.get(name, []), reference, _interval)

        if metric_type == "cpu":
            used = fresh("device_cpu_usage")
            if not used:
                continue
            value = sum(item[0] for item in used) / len(used)
        elif metric_type == "traffic":
            used = fresh("device_total_incoming_traffic") + fresh("device_total_outgoing_traffic")
            if not used:
                continue
            value = sum(item[0] for item in used)
        else:
            usage = fresh("device_memory_usage")
            used_bytes = fresh("device_memory_used")
            free = fresh("device_memory_free")
            total = fresh("device_memory_total")
            if usage:
                value = sum(item[0] for item in usage) / len(usage)
                used = usage
            elif used_bytes and total and sum(item[0] for item in total) > 0:
                value = sum(item[0] for item in used_bytes) / sum(item[0] for item in total) * 100
                used = used_bytes + total
            elif total and free and sum(item[0] for item in total) > 0:
                value = (sum(item[0] for item in total) - sum(item[0] for item in free)) / sum(item[0] for item in total) * 100
                used = total + free
            elif used_bytes and free and sum(item[0] for item in used_bytes) + sum(item[0] for item in free) > 0:
                value = sum(item[0] for item in used_bytes) / (sum(item[0] for item in used_bytes) + sum(item[0] for item in free)) * 100
                used = used_bytes + free
            else:
                continue
            if not 0 <= value <= 100:
                continue
        candidates.append(NetworkCandidate(instance_id, value, max(item[1] for item in used), metric_type))
    return candidates


def _candidates_from_detail(found: dict, metric_names: tuple[str, ...], metric_type: str):
    candidates = []
    if metric_type == "traffic":
        instance_ids = set().union(*(samples.keys() for samples in found.values())) if found else set()
        for instance_id in instance_ids:
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
        return candidates
    metric_name = metric_names[0]
    for instance_id, (value, sampled_at) in found[metric_name].items():
        candidates.append(NetworkCandidate(instance_id, value, sampled_at, metric_type))
    return candidates
