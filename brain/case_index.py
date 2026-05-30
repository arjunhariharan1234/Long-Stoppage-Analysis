"""Case index — build per-case signature vectors for nearest-neighbour retrieval.

Each confirmed theft case in confirmed_thefts/cases_parsed.json is reduced to a
fixed-length numeric vector (SIGNATURE_FEATURES). At scoring time, an unknown
trip is also projected onto the same feature space and compared via weighted
Euclidean distance.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from brain import CODEX_VERSION


SIGNATURE_FEATURES: tuple[str, ...] = (
    "detour_ratio",
    "stoppage_share",
    "max_halt_hrs",
    "halt_count_per_100km",
    "transit_distance_km",
    "unloading_time_hrs",
    "ping_density_per_km",
    "geofence_breached",
)


def _safe(d: dict, k: str, default: float = 0.0) -> float:
    v = d.get(k, default)
    try:
        f = float(v)
        return f
    except (TypeError, ValueError):
        return default


def build_signature_vector(feats: dict) -> dict:
    """Project a feature dict onto SIGNATURE_FEATURES."""
    transit_t = _safe(feats, "transit_time_hrs", 0.0)
    transit_km = _safe(feats, "transit_distance_km", 0.0)
    pings = _safe(feats, "ping_count", 0.0)
    poly_len = _safe(feats, "polyline_length_km", 0.0)
    return {
        "detour_ratio": _safe(feats, "detour_ratio", 1.0),
        "stoppage_share": (_safe(feats, "stoppage_hrs") / transit_t) if transit_t > 0 else 0.0,
        "max_halt_hrs": _safe(feats, "max_halt_hrs", _safe(feats, "stoppage_hrs", 0.0)),
        "halt_count_per_100km": (_safe(feats, "halt_count", 0.0) / max(transit_km, 1.0)) * 100,
        "transit_distance_km": transit_km,
        "unloading_time_hrs": _safe(feats, "unloading_time_hrs"),
        "ping_density_per_km": (pings / poly_len) if poly_len > 0 else 0.0,
        "geofence_breached": 1.0 if feats.get("geofence_breached") else 0.0,
    }


def _case_to_features(case: dict) -> dict:
    """Aggregate matched_trips inside a parsed case → flat feature dict."""
    trips = case.get("matched_trips", []) or []
    if not trips:
        return {}
    total_transit_km = sum(_safe(t, "transit_distance_km") for t in trips)
    total_planned_km = sum(_safe(t, "planned_distance_km") for t in trips)
    total_stoppage = sum(_safe(t, "total_stoppage_hrs") for t in trips)
    total_duration = sum(_safe(t, "trip_duration_hrs") for t in trips)
    halt_count = sum(int(_safe(t, "halt_count")) for t in trips)
    max_halt = max((_safe(t, "max_stoppage_hrs") for t in trips), default=0.0)
    return {
        "transit_distance_km": total_transit_km,
        "google_distance_km": total_planned_km,
        "detour_ratio": (total_transit_km / total_planned_km) if total_planned_km > 0 else 1.0,
        "stoppage_hrs": total_stoppage,
        "transit_time_hrs": total_duration,
        "halt_count": halt_count,
        "max_halt_hrs": max_halt,
        "unloading_time_hrs": 0.0,
        "ping_count": 0,
        "polyline_length_km": 0,
        "geofence_breached": False,
    }


def build_case_index(cases: list[dict]) -> dict:
    out = []
    for c in cases:
        feats = _case_to_features(c)
        vec = build_signature_vector(feats)
        out.append({
            "case_id": c.get("case_id"),
            "type": "confirmed_theft",
            "city": c.get("city"),
            "vehicle": c.get("vehicle_normalized") or c.get("vehicle_number_raw"),
            "transporter": c.get("vendor"),
            "loss_inr": c.get("loss_value_incident_inr"),
            "rca_summary": (c.get("rca") or "")[:200],
            "matched_trip_count": len(c.get("matched_trips", [])),
            "signature_vector": vec,
        })
    return {
        "version": CODEX_VERSION,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        "cases": out,
    }


def _first_non_null(series) -> object:
    """Return the first non-null value in a pandas Series, or None if all-null."""
    s = series.dropna()
    return s.iloc[0] if len(s) else None


def build_case_index_from_xlsx(training_df, extract_features_fn) -> dict:
    """Build the case index directly from the training xlsx.

    Groups rows by ``incident_trip_id`` (each group = one confirmed-theft case)
    and averages per-trip signature vectors to get an aggregated per-case
    signature. Per-case metadata (city, vehicle, transporter, theft_type,
    rca_summary, loss_inr) is taken from the first non-null value in the group.
    """
    df = training_df.dropna(subset=["incident_trip_id"])
    out: list[dict] = []
    for incident_trip_id, group in df.groupby("incident_trip_id"):
        case_id = f"CT-{int(incident_trip_id):010d}"
        city = _first_non_null(group["city"]) if "city" in group else None
        vehicle = _first_non_null(group["vehicle_number_clean"]) if "vehicle_number_clean" in group else None
        transporter = _first_non_null(group["window_transporter"]) if "window_transporter" in group else None
        theft_type = _first_non_null(group["theft_type"]) if "theft_type" in group else None
        rca_summary = _first_non_null(group["rca_summary"]) if "rca_summary" in group else None
        loss_inr_raw = _first_non_null(group["incident_loss_value"]) if "incident_loss_value" in group else None
        try:
            loss_inr = float(loss_inr_raw) if loss_inr_raw is not None else None
        except (TypeError, ValueError):
            loss_inr = None

        # Per-trip signature vectors → average per feature.
        vectors = []
        for row in group.to_dict(orient="records"):
            feats = extract_features_fn(row)
            vectors.append(build_signature_vector(feats))
        avg_vec: dict[str, float] = {}
        if vectors:
            for feat in SIGNATURE_FEATURES:
                avg_vec[feat] = sum(_safe(v, feat) for v in vectors) / len(vectors)
        else:
            avg_vec = {feat: 0.0 for feat in SIGNATURE_FEATURES}

        out.append({
            "case_id": case_id,
            "type": "confirmed_theft",
            "city": str(city) if city is not None else None,
            "vehicle": str(vehicle) if vehicle is not None else None,
            "transporter": str(transporter) if transporter is not None else None,
            "theft_type": str(theft_type) if theft_type is not None else None,
            "loss_inr": loss_inr,
            "rca_summary": (str(rca_summary)[:200] if rca_summary is not None else ""),
            "matched_trip_count": len(group),
            "signature_vector": avg_vec,
        })
    return {
        "version": CODEX_VERSION,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        "cases": out,
    }


def write_case_index(idx: dict, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(idx, indent=2))
