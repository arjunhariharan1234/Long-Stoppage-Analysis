"""Tests for brain.case_index."""
import pytest

from brain.case_index import (
    SIGNATURE_FEATURES,
    build_signature_vector,
    build_case_index,
)


def test_signature_features_is_fixed_list():
    assert isinstance(SIGNATURE_FEATURES, tuple)
    assert "detour_ratio" in SIGNATURE_FEATURES
    assert "stoppage_share" in SIGNATURE_FEATURES
    assert len(SIGNATURE_FEATURES) >= 8


def test_build_signature_vector_returns_dict_keyed_by_feature():
    feats = {
        "detour_ratio": 1.4, "stoppage_hrs": 2.0, "transit_time_hrs": 3.0,
        "transit_distance_km": 90, "google_distance_km": 65,
        "unloading_time_hrs": 0.05, "ping_count": 0, "polyline_length_km": 0,
        "geofence_breached": True,
    }
    vec = build_signature_vector(feats)
    assert set(vec.keys()) == set(SIGNATURE_FEATURES)
    assert vec["detour_ratio"] == pytest.approx(1.4)
    assert vec["stoppage_share"] == pytest.approx(2.0 / 3.0, abs=0.01)
    assert vec["geofence_breached"] == 1.0


def test_build_case_index_emits_per_case_entry():
    cases = [{
        "case_id": "CT-001", "city": "Lucknow", "vehicle_normalized": "UP32QT2997",
        "vendor": "A&A", "loss_value_incident_inr": 51924,
        "rca": "driver handover", "matched_trips": [
            {"trip_id": "T1", "transit_distance_km": 90, "planned_distance_km": 65,
             "trip_duration_hrs": 3.0, "total_stoppage_hrs": 2.0, "halt_count": 2,
             "max_stoppage_hrs": 1.25}
        ]
    }]
    idx = build_case_index(cases)
    assert idx["version"]
    assert len(idx["cases"]) == 1
    c = idx["cases"][0]
    assert c["case_id"] == "CT-001"
    assert c["type"] == "confirmed_theft"
    assert "signature_vector" in c
    assert set(c["signature_vector"].keys()) == set(SIGNATURE_FEATURES)
