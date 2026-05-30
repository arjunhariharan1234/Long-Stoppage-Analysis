"""Tests for brain.features."""
import math
import pytest

from brain.features import (
    decode_polyline,
    polyline_length_km,
    haversine_km,
    extract_trip_features,
)


def test_decode_polyline_returns_list_of_lat_lng(sample_polyline):
    pts = decode_polyline(sample_polyline)
    assert len(pts) == 3
    assert pts[0] == pytest.approx((26.7619, 80.8514), abs=1e-4)
    assert pts[2] == pytest.approx((26.7630, 80.8530), abs=1e-4)


def test_decode_polyline_empty_returns_empty_list():
    assert decode_polyline("") == []
    assert decode_polyline(None) == []


def test_haversine_km_known_distance():
    # ~111 km per degree of latitude near the equator
    d = haversine_km(0.0, 0.0, 1.0, 0.0)
    assert d == pytest.approx(111.19, abs=0.5)


def test_polyline_length_km_sums_segments(sample_polyline):
    length = polyline_length_km(sample_polyline)
    # 3 points, ~80m + ~130m ≈ 0.2 km
    assert 0.05 < length < 0.5


def test_extract_trip_features_basic_fields(sample_trip_row):
    feats = extract_trip_features(sample_trip_row)
    assert feats["transit_distance_km"] == pytest.approx(92.31, abs=0.01)
    assert feats["google_distance_km"] == pytest.approx(73.51, abs=0.01)
    assert feats["detour_ratio"] == pytest.approx(92.31 / 73.51, abs=0.01)
    assert feats["ping_count"] == 120
    assert feats["polyline_available"] is True
    assert feats["stoppage_hrs"] == pytest.approx(2.05, abs=0.01)
    assert feats["unloading_time_hrs"] == pytest.approx(0.0, abs=0.01)
    assert feats["geofence_breached"] is False


def test_extract_trip_features_handles_missing_polyline():
    row = {"ping_polyline": "", "window_distance_travelled_km": 50,
           "window_google_distance_km": 50, "ping_count": 0,
           "window_stoppage_hrs": 0, "window_unloading_time_hrs": 1,
           "window_geofence_breached": False, "window_transit_time_hrs": 2,
           "window_total_pings": 0, "window_closure_mode": "auto",
           "window_auto_closure_type": "system"}
    feats = extract_trip_features(row)
    assert feats["polyline_available"] is False
    assert feats["polyline_length_km"] == 0.0
