"""Feature engineering for the theft brain.

Converts a trip row + encoded polyline into a flat feature dict that the signal
evaluator and case-index builder both consume.
"""
from __future__ import annotations

import math
from typing import Any

import polyline as _polyline


EARTH_R_KM = 6371.0088


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in kilometres."""
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    dlat = lat2r - lat1r
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1r) * math.cos(lat2r) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


def decode_polyline(encoded: str | None) -> list[tuple[float, float]]:
    """Decode a Google encoded polyline into a list of (lat, lng) tuples."""
    if not encoded:
        return []
    try:
        return _polyline.decode(encoded)
    except Exception:
        return []


def polyline_length_km(encoded: str | None) -> float:
    pts = decode_polyline(encoded)
    if len(pts) < 2:
        return 0.0
    total = 0.0
    for (a_lat, a_lng), (b_lat, b_lng) in zip(pts, pts[1:]):
        total += haversine_km(a_lat, a_lng, b_lat, b_lng)
    return total


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        f = float(v)
        return default if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


def _safe_str(v: Any, default: str = "") -> str:
    """Coerce to string, treating NaN / None / non-strings as the default."""
    if v is None:
        return default
    if isinstance(v, float) and math.isnan(v):
        return default
    if not isinstance(v, str):
        try:
            return str(v)
        except Exception:
            return default
    return v


def _safe_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if v in (1, "1", "true", "True", "TRUE"):
        return True
    return False


def extract_trip_features(row: dict | Any) -> dict:
    """Pull a flat feature dict from a trip row.

    Accepts a pandas row, dict, or any mapping. Missing fields → safe defaults.
    """
    g = row.get if isinstance(row, dict) else (lambda k, d=None: getattr(row, k, d) if hasattr(row, k) else row[k] if k in row else d)

    polyline_enc = _safe_str(g("ping_polyline", ""))
    poly_len = polyline_length_km(polyline_enc)
    transit_km = _safe_float(g("window_distance_travelled_km"))
    google_km = _safe_float(g("window_google_distance_km"))

    return {
        "trip_id": _safe_str(g("window_trip_id", "")),
        "vehicle": _safe_str(g("vehicle_number_clean", "")),
        "driver_number": _safe_str(g("window_driver_number", "")),
        "transporter": _safe_str(g("window_transporter", "")),
        "origin": _safe_str(g("window_origin", "")),
        "destination": _safe_str(g("window_destination", "")),
        "transit_distance_km": transit_km,
        "google_distance_km": google_km,
        "detour_ratio": (transit_km / google_km) if google_km > 0 else 1.0,
        "transit_time_hrs": _safe_float(g("window_transit_time_hrs")),
        "stoppage_hrs": _safe_float(g("window_stoppage_hrs")),
        "unloading_time_hrs": _safe_float(g("window_unloading_time_hrs")),
        "ping_count": int(_safe_float(g("ping_count"))),
        "total_pings": int(_safe_float(g("window_total_pings"))),
        "polyline_available": len(polyline_enc) > 0,
        "polyline_length_km": poly_len,
        "geofence_breached": _safe_bool(g("window_geofence_breached")),
        "closure_mode": _safe_str(g("window_closure_mode", "")).lower(),
        "auto_closure_type": _safe_str(g("window_auto_closure_type", "")),
    }
