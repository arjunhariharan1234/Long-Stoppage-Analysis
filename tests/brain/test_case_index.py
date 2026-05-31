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


def test_build_case_index_from_xlsx_picks_closest_to_incident_per_case():
    """For each incident, the row with smallest days_before_incident is picked
    as the case representative (the actual incident row never appears in the
    dataset; the closest lookback trip is the best proxy).
    """
    import pandas as pd
    from brain.features import extract_trip_features
    from brain.case_index import (
        build_case_index_from_xlsx, extract_case_routes, SIGNATURE_FEATURES,
    )

    rows = []
    # Case 1: 4 lookback rows, days_before_incident in [5, 3, 1, 7].
    # The day-1 row should be picked as representative.
    for window_id, days, stop in [(100, 5, 0.5), (200, 3, 1.0),
                                    (300, 1, 2.0), (400, 7, 0.2)]:
        rows.append({"incident_trip_id": 54448970, "city": "Lucknow",
                     "vehicle_number_clean": "UP32QT2997",
                     "window_transporter": "A&A", "theft_type": "en-route",
                     "rca_summary": "narcotics", "incident_loss_value": 50000,
                     "window_origin": "LKO002M - Mohanlal Ganj",
                     "window_destination": "LKO005S - Aliganj",
                     "window_trip_id": window_id, "days_before_incident": days,
                     "ping_polyline": "",
                     "window_distance_travelled_km": 90,
                     "window_google_distance_km": 65,
                     "window_stoppage_hrs": stop, "window_transit_time_hrs": 3.0,
                     "window_unloading_time_hrs": 0.05,
                     "window_geofence_breached": False,
                     "window_closure_mode": "manual", "window_total_pings": 100,
                     "ping_count": 0, "window_driver_number": 9999})
    # Case 2: 2 lookback rows, days_before in [4, 2]. The day-2 row wins.
    for window_id, days, stop in [(500, 4, 0.2), (600, 2, 0.5)]:
        rows.append({"incident_trip_id": 11111111, "city": "Delhi",
                     "vehicle_number_clean": "DL01XX0000",
                     "window_transporter": "MHS", "theft_type": "concealment",
                     "rca_summary": "seal tamper", "incident_loss_value": 30000,
                     "window_origin": "DEL123M - Origin",
                     "window_destination": "DEL456S - Destination",
                     "window_trip_id": window_id, "days_before_incident": days,
                     "ping_polyline": "",
                     "window_distance_travelled_km": 50,
                     "window_google_distance_km": 48,
                     "window_stoppage_hrs": stop, "window_transit_time_hrs": 2.0,
                     "window_unloading_time_hrs": 1.0,
                     "window_geofence_breached": False,
                     "window_closure_mode": "manual", "window_total_pings": 80,
                     "ping_count": 0, "window_driver_number": 8888})
    df = pd.DataFrame(rows)
    idx = build_case_index_from_xlsx(df, extract_trip_features)
    assert len(idx["cases"]) == 2
    case_ids = [c["case_id"] for c in idx["cases"]]
    assert all(cid.startswith("CT-") for cid in case_ids)

    case1 = next(c for c in idx["cases"] if "Lucknow" == c["city"])
    assert case1["transporter"] == "A&A"
    assert case1["loss_inr"] == 50000
    assert case1["matched_trip_count"] == 1
    assert set(case1["signature_vector"].keys()) == set(SIGNATURE_FEATURES)
    # The closest-to-incident row (days=1) had stoppage_hrs=2.0.
    # stoppage_share = 2.0 / 3.0 ≈ 0.667
    assert case1["signature_vector"]["stoppage_share"] == pytest.approx(2.0/3.0, abs=0.01)
    assert case1["origin_code"] == "LKO002M"
    assert case1["destination_code"] == "LKO005S"

    case2 = next(c for c in idx["cases"] if "Delhi" == c["city"])
    # day-2 row had stoppage 0.5, so share = 0.5/2.0 = 0.25 (not 0.1 from day-4)
    assert case2["signature_vector"]["stoppage_share"] == pytest.approx(0.25, abs=0.01)

    routes = extract_case_routes(idx)
    assert ("LKO002M", "LKO005S") in routes
    assert ("DEL123M", "DEL456S") in routes
