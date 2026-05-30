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


def write_case_index(idx: dict, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(idx, indent=2))
