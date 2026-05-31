"""Tests for brain.codex_builder."""
import pytest

from brain.codex_builder import compute_weight, build_codex


def test_compute_weight_formula():
    # hit_rate 0.6, false_match 0.1 → weight = 50
    assert compute_weight(0.6, 0.1) == 50
    # hit_rate 0.1, false_match 0.05 → weight = 5
    assert compute_weight(0.1, 0.05) == 5
    # hit_rate < false_match → floor at 0
    assert compute_weight(0.05, 0.2) == 0


def test_build_codex_returns_versioned_dict():
    # Positives have a 1.4 detour with 90km transit and 65km Google → S-01 fires.
    positives = [
        {"driver_number": "7459901375", "vehicle": "UP32QT2997",
         "transporter": "A&A Associates - Zepto",
         "detour_ratio": 1.4, "transit_distance_km": 90, "google_distance_km": 65,
         "stoppage_hrs": 2.0, "transit_time_hrs": 3.0,
         "geofence_breached": False, "unloading_time_hrs": 0.05,
         "closure_mode": "manual", "total_pings": 100,
         "polyline_available": False, "polyline_length_km": 0,
         "ping_count": 0,
         "loading_time_hrs": 0.0, "tracking_health": 1.0,
         "gate_out_hour": 14, "gate_to_first_ping_min": 0.0,
         "alerts_count": 0, "eta_breach_hrs": 0.0,
         "destination_entry_present": True},
    ]
    negatives = [
        {"driver_number": "0000000000", "vehicle": "AB00XX0000",
         "transporter": "Other",
         "detour_ratio": 1.02, "transit_distance_km": 90, "google_distance_km": 88,
         "stoppage_hrs": 0.2, "transit_time_hrs": 3.0,
         "geofence_breached": False, "unloading_time_hrs": 0.5,
         "closure_mode": "manual", "total_pings": 200,
         "polyline_available": False, "polyline_length_km": 0,
         "ping_count": 0,
         "loading_time_hrs": 0.0, "tracking_health": 1.0,
         "gate_out_hour": 14, "gate_to_first_ping_min": 0.0,
         "alerts_count": 0, "eta_breach_hrs": 0.0,
         "destination_entry_present": True},
    ]
    blacklist = {"drivers": set(), "vehicles": set(), "transporters": set()}
    codex = build_codex(positives, negatives, blacklist,
                        training_meta={"confirmed_thefts": 1})
    assert "version" in codex
    assert "generated_at" in codex
    assert isinstance(codex["signals"], list)
    # S-01 should appear: positive hit-rate 1.0, negative 0.0 → high weight.
    assert any(s["id"] == "S-01" for s in codex["signals"])
    s1 = next(s for s in codex["signals"] if s["id"] == "S-01")
    assert s1["weight"] >= 5
    assert s1["training_hit_rate"] == 1.0
    assert s1["false_match_proxy"] == 0.0


def test_build_codex_drops_low_weight_signals():
    # All positives + negatives the same → every hit_rate == false_match → weight 0 → dropped
    same = {"driver_number": "0", "vehicle": "X", "transporter": "Y",
            "detour_ratio": 1.0, "transit_distance_km": 0, "google_distance_km": 0,
            "stoppage_hrs": 0, "transit_time_hrs": 0,
            "geofence_breached": False, "unloading_time_hrs": 0.5,
            "closure_mode": "manual", "total_pings": 100,
            "polyline_available": False, "polyline_length_km": 0,
            "ping_count": 0}
    codex = build_codex([same], [same], {"drivers": set(), "vehicles": set(), "transporters": set()},
                        training_meta={"confirmed_thefts": 0})
    assert len(codex["signals"]) == 0
