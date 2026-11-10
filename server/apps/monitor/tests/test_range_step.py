import pytest

from apps.monitor.services.range_step import MAX_AUTO_RANGE_POINTS, auto_range_step, query_range_point_count, resolve_range_step

HOUR = 3600
DAY = 86400


def test_short_windows_keep_five_minutes():
    assert auto_range_step(HOUR) == "5m"
    assert auto_range_step(6 * HOUR) == "5m"
    assert auto_range_step(3 * DAY) == "5m"
    assert query_range_point_count(3 * DAY, 300) <= MAX_AUTO_RANGE_POINTS


def test_auto_step_tracks_window_length():
    seven_days = 7 * DAY
    assert auto_range_step(seven_days) == "15m"
    assert query_range_point_count(seven_days, 600) > MAX_AUTO_RANGE_POINTS
    assert query_range_point_count(seven_days, 900) <= MAX_AUTO_RANGE_POINTS

    assert auto_range_step(30 * DAY) == "1h"
    assert auto_range_step(45 * DAY) == "2h"
    assert auto_range_step(90 * DAY) == "6h"
    assert auto_range_step(400 * DAY) == "1d"


def test_five_minute_budget_boundary():
    stays = 299_999
    overflows = 300_000
    assert auto_range_step(stays) == "5m"
    assert query_range_point_count(stays, 300) == MAX_AUTO_RANGE_POINTS
    assert auto_range_step(overflows) == "10m"
    assert query_range_point_count(overflows, 300) == MAX_AUTO_RANGE_POINTS + 1


def test_non_positive_duration_uses_default():
    assert auto_range_step(0) == "5m"
    assert auto_range_step(-60) == "5m"


def test_explicit_step_wins_over_window():
    assert resolve_range_step(7 * DAY, "1m") == "1m"
    assert resolve_range_step(HOUR, "30m") == "30m"
    assert resolve_range_step(7 * DAY, None) == "15m"
    assert resolve_range_step(7 * DAY, "") == "15m"


def test_explicit_step_must_parse():
    with pytest.raises(ValueError):
        resolve_range_step(HOUR, "abc")
