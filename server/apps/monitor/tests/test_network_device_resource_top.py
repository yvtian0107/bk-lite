from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from apps.monitor.management.services.plugin_migrate import _build_common_ifmib_metrics
from apps.monitor.services.metric_query_contract import build_instance_matcher_groups, join_label_queries
from apps.monitor.services.network_device_resource_top import (
    CPU_MEMORY_OBJECT_NAMES,
    NetworkDeviceResourceTopService,
    build_ranked_rows,
    collection_interval_seconds,
    freshness_cutoff_literal,
    gauge_search_window_seconds,
    load_network_device_detail_metrics,
    traffic_search_window_seconds,
)

NOW = datetime(2026, 7, 22, 12, tzinfo=timezone.utc)
NO_CARD_OBJECTS = (
    "Wireless",
    "Access",
    "Transmission",
    "NetworkService",
    "ConsoleServer",
    "VoiceGateway",
)
CATALOG_SELECTOR = "{instance_type='switch', __$labels__}"


class FakeVM:
    def __init__(self, rows_by_marker):
        self.rows_by_marker = rows_by_marker
        self.calls = []

    def query(self, query, **kwargs):
        self.calls.append((query, kwargs))
        for marker, rows in self.rows_by_marker.items():
            if marker in query:
                return {"status": "success", "data": {"result": rows}}
        return {"status": "success", "data": {"result": []}}


def _point(instance_id, value, sampled_at=NOW):
    return {"metric": {"instance_id": instance_id}, "value": [sampled_at.timestamp(), str(value)]}


def _device(instance_id, object_name, *, interval=300, keys=("instance_id",), type_id="Network Device", name=""):
    return SimpleNamespace(
        id=instance_id,
        name=name or instance_id,
        ip="10.0.0.1",
        interval=interval,
        monitor_object=SimpleNamespace(name=object_name, type_id=type_id, instance_id_keys=list(keys)),
    )


def _run(metric_type, devices, rows_by_marker):
    vm = FakeVM(rows_by_marker)
    rows = NetworkDeviceResourceTopService(vm_api=vm, now=NOW).run(metric_type, devices)
    return rows, vm


def _binding(object_name, metric_name):
    return load_network_device_detail_metrics()[(object_name, metric_name)]


def _catalog(metric_name):
    return next(item["query"] for item in _build_common_ifmib_metrics("switch", "") if item["name"] == metric_name)


def _expected_traffic_query(metric_name, instance_id, interval):
    matcher = build_instance_matcher_groups((instance_id,), ["instance_id"])[0][0]
    query = _catalog(metric_name).replace(CATALOG_SELECTOR, "{" + matcher + "}")
    cutoff = freshness_cutoff_literal(NOW, collection_interval_seconds(interval))

    def _gate(match):
        selector = f"{match.group(1)}{{{match.group(2)}}}"
        return f"(rate({selector}[5m]) and ignoring(__name__) (timestamp({selector}) >= {cutoff}))"

    import re

    return re.sub(r"rate\(([A-Za-z_:][A-Za-z0-9_:]*)\{([^{}]*)\}\[5m\]\)", _gate, query)


def test_cpu_and_memory_bindings_cover_only_the_five_detail_objects():
    bindings = load_network_device_detail_metrics()
    assert {object_name for object_name, _metric_name in bindings} == set(CPU_MEMORY_OBJECT_NAMES)
    assert {metric_name for _object_name, metric_name in bindings} == {"device_cpu_usage", "device_memory_usage"}


@pytest.mark.parametrize(
    ("object_name", "metric_name", "snippet"),
    [
        ("Switch", "device_cpu_usage", "max("),
        ("Router", "device_cpu_usage", "avg("),
        ("Firewall", "device_cpu_usage", "avg("),
        ("Loadbalance", "device_cpu_usage", "avg("),
        ("Wanopt", "device_cpu_usage", "snmp_device_cpu_usage"),
        ("Switch", "device_memory_usage", "device_memory_usage"),
    ],
)
def test_ranked_gauge_sends_the_detail_capability_unchanged(object_name, metric_name, snippet):
    metric_type = "cpu" if metric_name == "device_cpu_usage" else "memory"
    rows, vm = _run(metric_type, [_device("sw-1", object_name, interval=300)], {"device_": [_point("sw-1", 12.5)]})
    template = _binding(object_name, metric_name).template
    expected = join_label_queries(template, build_instance_matcher_groups(("sw-1",), ["instance_id"]))
    assert snippet in template
    assert vm.calls[0][0] == expected
    assert "timestamp(" not in vm.calls[0][0]
    assert vm.calls[0][1]["step"] == "601s"
    assert vm.calls[0][1]["lookback_delta"] == "601s"
    assert rows[0]["value"] == 12.5
    assert rows[0]["unit"] == "percent"
    assert rows[0]["sampled_at"] == NOW.isoformat()


def test_wanopt_cpu_keeps_snmp_before_the_unprefixed_series():
    template = _binding("Wanopt", "device_cpu_usage").template
    assert template.index("snmp_device_cpu_usage") < template.index("device_cpu_usage{")


def test_switch_memory_keeps_the_detail_or_order():
    template = _binding("Switch", "device_memory_usage").template
    positions = [template.index(name) for name in ("device_memory_usage", "device_memory_used", "device_memory_total")]
    assert positions == sorted(positions)


def test_objects_without_a_cpu_or_memory_card_are_absent_and_not_averaged():
    devices = [_device(f"dev-{name}", name) for name in NO_CARD_OBJECTS]
    devices.append(_device("probe-1", "Probe"))
    for metric_type in ("cpu", "memory"):
        rows, vm = _run(metric_type, devices, {"__name__": [_point("dev-Wireless", 88)]})
        assert rows == []
        assert vm.calls == []


def test_incomplete_identity_is_not_queried_by_its_first_segment():
    device = _device(("collector", "ap-1"), "Switch", keys=("instance_id", "resource_id"))
    rows, vm = _run("cpu", [device], {"device_cpu_usage": [_point("collector", 70)]})
    assert rows == []
    assert vm.calls == []
    assert "collector" not in "".join(query for query, _kwargs in vm.calls)


def test_gauge_lookback_is_two_intervals_plus_one_second_for_each_device():
    devices = [
        _device("fast", "Switch", interval=60),
        _device("normal", "Router", interval=300),
        _device("slow", "Firewall", interval=600),
        _device("unset", "Loadbalance", interval=None),
        _device("illegal", "Wanopt", interval="soon"),
    ]
    _rows, vm = _run("cpu", devices, {})
    windows = {call[1]["step"] for call in vm.calls}
    assert windows == {"121s", "601s", "1201s"}
    assert all(call[1]["lookback_delta"] == call[1]["step"] for call in vm.calls)
    assert gauge_search_window_seconds(60) == 121
    assert gauge_search_window_seconds(300) == 601
    assert collection_interval_seconds("soon") == 300
    assert collection_interval_seconds(0) == 300


def test_traffic_uses_the_public_ifmib_or_then_sum_and_raw_timestamp_gate():
    incoming = _catalog("device_total_incoming_traffic")
    outgoing = _catalog("device_total_outgoing_traffic")
    assert incoming.startswith("sum(rate(interface_ifHCInOctets")
    assert "or rate(interface_ifInOctets" in incoming
    assert "[5m]" in incoming and "[15m]" not in incoming
    assert outgoing.startswith("sum(rate(interface_ifHCOutOctets")
    rows, vm = _run(
        "traffic",
        [_device("sw-1", "Switch", interval=60)],
        {
            "ifHCInOctets": [_point("sw-1", 10)],
            "ifHCOutOctets": [_point("sw-1", 5)],
        },
    )
    queries = [query for query, _kwargs in vm.calls]
    assert queries[0] == _expected_traffic_query("device_total_incoming_traffic", "sw-1", 60)
    assert queries[1] == _expected_traffic_query("device_total_outgoing_traffic", "sw-1", 60)
    assert all(call[1]["step"] == "300s" and call[1]["lookback_delta"] == "300s" for call in vm.calls)
    assert '__name__="' not in "".join(queries)
    assert "instance_type=" not in "".join(queries)
    assert "[15m]" not in "".join(queries)
    assert rows[0]["value"] == 15.0
    assert rows[0]["unit"] == "byteps"


def test_traffic_lookback_is_the_wider_of_five_minutes_and_two_intervals():
    devices = [
        _device("fast", "Wireless", interval=60),
        _device("normal", "Access", interval=300),
        _device("slow", "Transmission", interval=600),
    ]
    _rows, vm = _run("traffic", devices, {})
    by_window = {}
    for query, kwargs in vm.calls:
        by_window.setdefault(kwargs["step"], set()).add(query)
    assert set(by_window) == {"300s", "601s", "1201s"}
    assert traffic_search_window_seconds(60) == 300
    assert traffic_search_window_seconds(600) == 1201
    fast_query = next(iter(by_window["300s"]))
    assert str(int(NOW.timestamp()) - 120) in fast_query
    slow_query = next(iter(by_window["1201s"]))
    assert str(int(NOW.timestamp()) - 1200) in slow_query


def test_traffic_without_samples_and_multi_key_devices_are_absent():
    devices = [
        _device("silent", "Wireless"),
        _device(("collector", "ap-1"), "Switch", keys=("instance_id", "resource_id")),
        _device("host-1", "Host", type_id="OS"),
    ]
    rows, vm = _run("traffic", devices, {"ifHCInOctets": [_point("collector", 9)]})
    assert rows == []
    sent = "".join(query for query, _kwargs in vm.calls)
    assert "silent" in sent
    assert "collector" not in sent
    assert "host-1" not in sent


def test_unauthorized_instance_is_not_part_of_the_matcher_and_rows_stay_sorted():
    devices = [
        _device("sw-1", "Switch", name="B"),
        _device("host-1", "Host", type_id="OS", name="secret-1"),
    ]
    rows, vm = _run("cpu", devices, {"device_cpu_usage": [_point("sw-1", 3)]})
    assert "secret-1" not in vm.calls[0][0]
    assert "sw\\\\-1" in vm.calls[0][0]
    assert [row["instance_id"] for row in rows] == ["sw-1"]


def test_ranking_sorts_before_rounding_and_keeps_the_existing_fields():
    devices = [
        _device("a", "Switch", name="A"),
        _device("b", "Switch", name="B"),
        _device("c", "Switch", name="A"),
    ]
    rows, _vm = _run(
        "cpu",
        devices,
        {"device_cpu_usage": [_point("a", 10.126), _point("b", 10.126), _point("c", 2)]},
    )
    assert [row["instance_id"] for row in rows] == ["a", "b", "c"]
    assert rows[0]["value"] == 10.13
    assert list(rows[0]) == [
        "rank",
        "display_name",
        "ip",
        "instance_id",
        "device_type",
        "value",
        "unit",
        "sampled_at",
    ]


def test_result_timestamp_is_stored_as_sampled_at_without_a_python_age_filter():
    stale_point = datetime(2026, 7, 22, 11, tzinfo=timezone.utc)
    rows, _vm = _run("cpu", [_device("sw-1", "Switch", interval=60)], {"device_cpu_usage": [_point("sw-1", 4, stale_point)]})
    assert rows[0]["sampled_at"] == stale_point.isoformat()
    ranked = build_ranked_rows([], {}, limit=10)
    assert ranked == []
