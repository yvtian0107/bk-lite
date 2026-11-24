import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from apps.monitor.services.metric_query_contract import build_instance_matcher_groups, join_label_queries
from apps.monitor.services.metric_series import MAX_INSTANCE_IDS
from apps.monitor.services.network_device_resource_top import (
    NetworkCandidate,
    NetworkDeviceResourceTopService,
    build_ranked_rows,
    validate_metric_type,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
DASHBOARD_OBJECTS = REPO_ROOT / "web/src/app/monitor/dashboards/objects"
DASHBOARD_CORE = REPO_ROOT / "web/src/app/monitor/dashboards/objects/common/simple-dashboard-core.tsx"
NETWORK_OBJECT_CONFIGS = (
    "switch",
    "router",
    "firewall",
    "loadbalance",
    "wanopt",
    "wireless",
    "access",
    "transmission",
    "network_service",
    "console_server",
    "voice_gateway",
)
DETAIL_METRIC_NAMES = (
    "device_cpu_usage",
    "device_memory_usage",
    "device_total_incoming_traffic",
    "device_total_outgoing_traffic",
)
NOW = datetime(2026, 7, 22, 12, tzinfo=timezone.utc)


def _dashboard_metric_queries(route_key: str) -> dict[str, str]:
    text = (DASHBOARD_OBJECTS / route_key / "config.ts").read_text(encoding="utf-8")
    found = {}
    pattern = re.compile(
        r"name:\s*'(?P<name>device_(?:cpu_usage|memory_usage|total_incoming_traffic|total_outgoing_traffic))'"
        r"(?P<body>[\s\S]{0,4000}?)"
        r"query:\s*\n?\s*'(?P<query>(?:\\'|[^'])*)'",
    )
    for match in pattern.finditer(text):
        found[match.group("name")] = match.group("query")
    return found


def _instance(instance_id, object_name, type_id="Network Device", interval=300):
    return SimpleNamespace(
        id=instance_id,
        name=object_name,
        ip="10.0.0.8",
        interval=interval,
        monitor_object=SimpleNamespace(name=object_name, type_id=type_id, instance_id_keys=["instance_id"]),
    )


def _point(instance_id, value, sampled_at=NOW):
    return {"metric": {"instance_id": instance_id}, "value": [sampled_at.timestamp(), str(value)]}


class RecordingVM:
    def __init__(self, responder):
        self.calls = []
        self.responder = responder

    def query(self, query, **kwargs):
        self.calls.append((query, kwargs))
        return {"status": "success", "data": {"result": self.responder(query, kwargs)}}


def _render(template: str, *instance_ids: str) -> str:
    groups = build_instance_matcher_groups(tuple(instance_ids), ["instance_id"])
    return join_label_queries(template, groups).replace("__$window__", "15m")


def test_detail_window_matches_the_professional_dashboard_default():
    from apps.monitor.services.network_device_resource_top import DETAIL_DEFAULT_WINDOW_MINUTES, DETAIL_QUERY_CHUNK_SIZE

    source = DASHBOARD_CORE.read_text(encoding="utf-8")
    assert "originValue: 15" in source
    assert DETAIL_DEFAULT_WINDOW_MINUTES == 15
    assert DETAIL_QUERY_CHUNK_SIZE == MAX_INSTANCE_IDS


def test_resource_templates_come_from_professional_dashboard_configs():
    from apps.monitor.services.network_device_resource_top import load_network_device_detail_metrics

    bindings = load_network_device_detail_metrics()
    seen = set()
    for route_key in NETWORK_OBJECT_CONFIGS:
        queries = _dashboard_metric_queries(route_key)
        assert queries, route_key
        for metric_name, template in queries.items():
            assert metric_name in DETAIL_METRIC_NAMES
            binding = bindings[(_object_name(route_key), metric_name)]
            assert binding.template == template
            assert "__$labels__" in template
            seen.add((binding.object_name, metric_name))
    assert ("Switch", "device_cpu_usage") in seen
    assert ("Wireless", "device_cpu_usage") not in seen
    assert ("Wireless", "device_total_incoming_traffic") in seen


def _object_name(route_key: str) -> str:
    names = {
        "switch": "Switch",
        "router": "Router",
        "firewall": "Firewall",
        "loadbalance": "Loadbalance",
        "wanopt": "Wanopt",
        "wireless": "Wireless",
        "access": "Access",
        "transmission": "Transmission",
        "network_service": "NetworkService",
        "console_server": "ConsoleServer",
        "voice_gateway": "VoiceGateway",
    }
    return names[route_key]


def test_switch_cpu_uses_dashboard_max_and_router_family_uses_avg():
    switch_query = _dashboard_metric_queries("switch")["device_cpu_usage"]
    router_query = _dashboard_metric_queries("router")["device_cpu_usage"]
    firewall_query = _dashboard_metric_queries("firewall")["device_cpu_usage"]
    loadbalance_query = _dashboard_metric_queries("loadbalance")["device_cpu_usage"]
    wanopt_query = _dashboard_metric_queries("wanopt")["device_cpu_usage"]
    assert switch_query.startswith("max(device_cpu_usage{__$labels__})")
    assert "max(snmp_device_cpu_usage{__$labels__})" in switch_query
    assert router_query == firewall_query == loadbalance_query
    assert router_query.startswith("avg(device_cpu_usage{__$labels__})")
    assert "avg(snmp_device_cpu_usage{__$labels__})" in router_query
    assert wanopt_query.startswith("avg(snmp_device_cpu_usage{__$labels__})")

    def respond(query, kwargs):
        assert kwargs["step"] == "15m"
        assert kwargs["lookback_delta"] == "15m"
        if query == _render(switch_query, "sw-1"):
            return [_point("sw-1", 91)]
        if query == _render(router_query, "fw-1", "lb-1", "rt-1"):
            return [_point("rt-1", 22), _point("fw-1", 44), _point("lb-1", 33)]
        if query == _render(wanopt_query, "wan-1"):
            return [_point("wan-1", 17)]
        raise AssertionError(query)

    vm = RecordingVM(respond)
    rows = NetworkDeviceResourceTopService(vm_api=vm, now=NOW).run(
        "cpu",
        [
            _instance("sw-1", "Switch"),
            _instance("rt-1", "Router"),
            _instance("fw-1", "Firewall"),
            _instance("lb-1", "Loadbalance"),
            _instance("wan-1", "Wanopt"),
            _instance("ap-1", "Wireless"),
            _instance("host-1", "Switch", type_id="OS"),
        ],
    )

    assert [row["instance_id"] for row in rows] == ["sw-1", "fw-1", "lb-1", "rt-1", "wan-1"]
    assert [row["value"] for row in rows] == [91.0, 44.0, 33.0, 22.0, 17.0]
    assert all(row["unit"] == "percent" for row in rows)
    assert len(vm.calls) == 3
    issued = [query for query, _kwargs in vm.calls]
    assert all("ap-1" not in query and "host-1" not in query for query in issued)


def test_memory_queries_keep_each_object_fallback_order():
    expected_order = {
        "switch": (
            "max(device_memory_usage{__$labels__}) by (instance_id)",
            "avg(device_memory_usage{__$labels__}) by (instance_id)",
            (
                "(sum(device_memory_used{__$labels__}) by (instance_id) / "
                "(sum(device_memory_used{__$labels__}) by (instance_id) + "
                "sum(device_memory_free{__$labels__}) by (instance_id)) * 100)"
            ),
            "(sum(device_memory_used{__$labels__}) by (instance_id) / sum(device_memory_total{__$labels__}) by (instance_id) * 100)",
        ),
        "router": (
            "avg(device_memory_usage{__$labels__}) by (instance_id)",
            (
                "(sum(device_memory_used{__$labels__}) by (instance_id) / "
                "(sum(device_memory_used{__$labels__}) by (instance_id) + "
                "sum(device_memory_free{__$labels__}) by (instance_id)) * 100)"
            ),
            (
                "((sum(device_memory_total{__$labels__}) by (instance_id) - "
                "sum(device_memory_free{__$labels__}) by (instance_id)) / "
                "sum(device_memory_total{__$labels__}) by (instance_id) * 100)"
            ),
        ),
        "firewall": (
            "avg(device_memory_usage{__$labels__}) by (instance_id)",
            "avg(snmp_device_memory_usage{__$labels__}) by (instance_id)",
            (
                "((sum(device_memory_total{__$labels__}) by (instance_id) - "
                "sum(device_memory_free{__$labels__}) by (instance_id)) / "
                "sum(device_memory_total{__$labels__}) by (instance_id) * 100)"
            ),
        ),
        "loadbalance": (
            "avg(device_memory_usage{__$labels__}) by (instance_id)",
            "(sum(device_memory_used{__$labels__}) by (instance_id) / sum(device_memory_total{__$labels__}) by (instance_id) * 100)",
            "(sum(snmp_device_memory_used{__$labels__}) by (instance_id) / sum(snmp_device_memory_total{__$labels__}) by (instance_id) * 100)",
        ),
        "wanopt": (
            "(sum(snmp_device_memory_used{__$labels__}) by (instance_id) / sum(snmp_device_memory_total{__$labels__}) by (instance_id) * 100)",
            "avg(device_memory_usage{__$labels__}) by (instance_id)",
            "(sum(device_memory_used{__$labels__}) by (instance_id) / sum(device_memory_total{__$labels__}) by (instance_id) * 100)",
        ),
    }
    templates = {}
    for route_key, branches in expected_order.items():
        template = _dashboard_metric_queries(route_key)["device_memory_usage"]
        cursor = 0
        for branch in branches:
            found = template.find(branch, cursor)
            assert found >= cursor, (route_key, branch)
            cursor = found + len(branch)
        templates[route_key] = template

    def respond(query, _kwargs):
        if query == _render(templates["switch"], "sw-1"):
            return [_point("sw-1", 80)]
        if query == _render(templates["router"], "rt-1"):
            return [_point("rt-1", 70)]
        if query == _render(templates["firewall"], "fw-1"):
            return [_point("fw-1", 60)]
        if query == _render(templates["loadbalance"], "lb-1"):
            return [_point("lb-1", 50)]
        if query == _render(templates["wanopt"], "wan-1"):
            return [_point("wan-1", 40)]
        raise AssertionError(query)

    rows = NetworkDeviceResourceTopService(vm_api=RecordingVM(respond), now=NOW).run(
        "memory",
        [
            _instance("sw-1", "Switch"),
            _instance("rt-1", "Router"),
            _instance("fw-1", "Firewall"),
            _instance("lb-1", "Loadbalance"),
            _instance("wan-1", "Wanopt"),
        ],
    )
    assert [(row["instance_id"], row["value"]) for row in rows] == [
        ("sw-1", 80.0),
        ("rt-1", 70.0),
        ("fw-1", 60.0),
        ("lb-1", 50.0),
        ("wan-1", 40.0),
    ]


def test_traffic_sums_dashboard_inbound_and_outbound_rates():
    incoming = _dashboard_metric_queries("switch")["device_total_incoming_traffic"]
    outgoing = _dashboard_metric_queries("switch")["device_total_outgoing_traffic"]
    assert incoming.index("interface_ifHCInOctets") < incoming.index("interface_ifInOctets")
    assert outgoing.index("interface_ifHCOutOctets") < outgoing.index("interface_ifOutOctets")
    assert _dashboard_metric_queries("wireless")["device_total_incoming_traffic"] == incoming
    assert _dashboard_metric_queries("router")["device_total_outgoing_traffic"] == outgoing

    def respond(query, kwargs):
        assert kwargs["step"] == "15m"
        assert "[15m]" in query
        if query == _render(incoming, "ap-1", "sw-1"):
            return [_point("sw-1", 10), _point("ap-1", 1)]
        if query == _render(outgoing, "ap-1", "sw-1"):
            return [_point("sw-1", 4), _point("ap-1", 0)]
        raise AssertionError(query)

    rows = NetworkDeviceResourceTopService(vm_api=RecordingVM(respond), now=NOW).run(
        "traffic",
        [_instance("sw-1", "Switch"), _instance("ap-1", "Wireless")],
    )
    assert [(row["instance_id"], row["value"], row["unit"]) for row in rows] == [
        ("sw-1", 14.0, "byteps"),
        ("ap-1", 1.0, "byteps"),
    ]


def test_missing_zero_and_stale_samples_follow_the_detail_window():
    template = _dashboard_metric_queries("switch")["device_cpu_usage"]

    def respond(query, _kwargs):
        assert query == _render(template, "fresh-1", "gone-1", "old-1", "zero-1")
        return [
            _point("fresh-1", 12, NOW - timedelta(minutes=12)),
            _point("old-1", 99, NOW - timedelta(minutes=20)),
            _point("zero-1", 0, NOW),
        ]

    rows = NetworkDeviceResourceTopService(vm_api=RecordingVM(respond), now=NOW).run(
        "cpu",
        [
            _instance("fresh-1", "Switch"),
            _instance("old-1", "Switch"),
            _instance("zero-1", "Switch"),
            _instance("gone-1", "Switch"),
        ],
    )
    assert [(row["instance_id"], row["value"]) for row in rows] == [("fresh-1", 12.0), ("zero-1", 0.0)]


def test_tuple_instance_id_is_matched_inside_the_dashboard_query():
    template = _dashboard_metric_queries("switch")["device_cpu_usage"]

    def respond(query, _kwargs):
        assert query == _render(template, "switch-1")
        return [_point("switch-1", 55)]

    rows = NetworkDeviceResourceTopService(vm_api=RecordingVM(respond), now=NOW).run(
        "cpu",
        [_instance("('switch-1',)", "Switch")],
    )
    assert rows[0]["instance_id"] == "switch-1"
    assert rows[0]["value"] == 55.0


def test_memory_value_is_not_clamped_to_a_percentage():
    template = _dashboard_metric_queries("router")["device_memory_usage"]

    def respond(query, _kwargs):
        assert query == _render(template, "rt-1")
        return [_point("rt-1", 140), _point("rt-1", -1, NOW - timedelta(minutes=1))]

    rows = NetworkDeviceResourceTopService(vm_api=RecordingVM(respond), now=NOW).run(
        "memory",
        [_instance("rt-1", "Router")],
    )
    assert rows[0]["value"] == 140.0


def test_one_traffic_direction_is_kept_when_the_other_is_absent():
    incoming = _dashboard_metric_queries("router")["device_total_incoming_traffic"]
    outgoing = _dashboard_metric_queries("router")["device_total_outgoing_traffic"]

    def respond(query, _kwargs):
        if query == _render(incoming, "rt-1"):
            return [_point("rt-1", 8)]
        if query == _render(outgoing, "rt-1"):
            return []
        raise AssertionError(query)

    rows = NetworkDeviceResourceTopService(vm_api=RecordingVM(respond), now=NOW).run(
        "traffic",
        [_instance("rt-1", "Router")],
    )
    assert rows[0]["value"] == 8.0


def test_same_detail_template_is_chunked_at_the_instance_cap(monkeypatch):
    import apps.monitor.services.network_device_resource_top as service

    monkeypatch.setattr(service, "DETAIL_QUERY_CHUNK_SIZE", 2)
    template = _dashboard_metric_queries("switch")["device_cpu_usage"]
    calls = []

    def respond(query, _kwargs):
        calls.append(query)
        return []

    NetworkDeviceResourceTopService(vm_api=RecordingVM(respond), now=NOW).run(
        "cpu",
        [_instance("sw-1", "Switch"), _instance("sw-2", "Switch"), _instance("sw-3", "Switch")],
    )
    assert calls == [
        _render(template, "sw-1", "sw-2"),
        _render(template, "sw-3"),
    ]


def test_network_candidates_are_filtered_to_fresh_supported_devices_and_ranked():
    meta = {
        "sw-1": {"name": "Switch A", "ip": "10.0.0.1", "object_name": "Switch", "object_type_id": "Network Device", "interval": 60},
        "router-1": {"name": "Router A", "ip": "10.0.0.2", "object_name": "Router", "object_type_id": "Network Device", "interval": 60},
    }
    rows = build_ranked_rows(
        [
            NetworkCandidate("sw-1", 80, NOW, "cpu"),
            NetworkCandidate("router-1", 90, NOW, "cpu"),
        ],
        meta,
    )
    assert [row["instance_id"] for row in rows] == ["router-1", "sw-1"]
    assert rows[0]["value"] == 90.0
    assert rows[0]["rank"] == 1


def test_validate_metric_type_rejects_unknown_metric():
    assert validate_metric_type("traffic") == "traffic"
    try:
        validate_metric_type("disk")
    except ValueError as exc:
        assert "cpu" in str(exc)
    else:
        raise AssertionError("expected ValueError")
