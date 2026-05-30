"""Tests for brain.signals."""
import pytest

from brain.signals import SIGNAL_REGISTRY, evaluate_signal, evaluate_all_signals


def test_registry_has_categories():
    cats = {s["category"] for s in SIGNAL_REGISTRY}
    assert "ping_pattern" in cats
    assert "halt_signature" in cats
    assert "closure_anomaly" in cats


def test_registry_ids_unique():
    ids = [s["id"] for s in SIGNAL_REGISTRY]
    assert len(ids) == len(set(ids)), f"duplicate signal ids: {ids}"


def test_detour_signal_fires_on_large_detour():
    feats = {"detour_ratio": 1.5, "transit_distance_km": 100, "google_distance_km": 67}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-01")
    result = evaluate_signal(sig, feats)
    assert result["fires"] is True


def test_detour_signal_does_not_fire_on_normal_trip():
    feats = {"detour_ratio": 1.05, "transit_distance_km": 100, "google_distance_km": 95}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-01")
    result = evaluate_signal(sig, feats)
    assert result["fires"] is False


def test_low_ping_density_fires():
    feats = {"polyline_length_km": 100, "ping_count": 10, "polyline_available": True}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-02")
    assert evaluate_signal(sig, feats)["fires"] is True


def test_low_unloading_anomaly_fires():
    feats = {"unloading_time_hrs": 0.05, "transit_time_hrs": 3.0}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-10")
    assert evaluate_signal(sig, feats)["fires"] is True


def test_auto_closure_with_low_pings_fires():
    feats = {"closure_mode": "auto", "total_pings": 30, "transit_distance_km": 100}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-11")
    assert evaluate_signal(sig, feats)["fires"] is True


def test_evaluate_all_signals_returns_dict_with_score(sample_trip_row):
    from brain.features import extract_trip_features
    feats = extract_trip_features(sample_trip_row)
    result = evaluate_all_signals(feats)
    assert "score" in result
    assert "matched" in result
    assert isinstance(result["matched"], list)


def test_driver_blacklist_fires():
    feats = {"driver_number": "7459901375"}
    ctx = {"blacklist": {"drivers": {"7459901375", "9999999999"}, "vehicles": set(), "transporters": set()}}
    from brain.signals import SIGNAL_REGISTRY, evaluate_signal
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-04")
    assert evaluate_signal(sig, feats, ctx)["fires"] is True


def test_driver_blacklist_does_not_fire_for_unknown():
    feats = {"driver_number": "0000000000"}
    ctx = {"blacklist": {"drivers": {"7459901375"}, "vehicles": set(), "transporters": set()}}
    from brain.signals import SIGNAL_REGISTRY, evaluate_signal
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-04")
    assert evaluate_signal(sig, feats, ctx)["fires"] is False


def test_vehicle_blacklist_fires():
    feats = {"vehicle": "UP32QT2997"}
    ctx = {"blacklist": {"drivers": set(), "vehicles": {"UP32QT2997"}, "transporters": set()}}
    from brain.signals import SIGNAL_REGISTRY, evaluate_signal
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-05")
    assert evaluate_signal(sig, feats, ctx)["fires"] is True


def test_transporter_repeat_offender_fires():
    feats = {"transporter": "A&A Associates - Zepto"}
    ctx = {"blacklist": {"drivers": set(), "vehicles": set(),
                          "transporters": {"a&a associates - zepto"}}}
    from brain.signals import SIGNAL_REGISTRY, evaluate_signal
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-06")
    assert evaluate_signal(sig, feats, ctx)["fires"] is True
