"""Feature engineering for the theft brain.

Converts a trip row + encoded polyline into a flat feature dict that the signal
evaluator and case-index builder both consume.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import pandas as pd
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
    """Decode a polyline string into a list of (lat, lng) tuples.

    Handles two formats:
      1. Google encoded polyline string (e.g. ``_qo]_ulN...``)
      2. JSON-array string of [lat, lng] pairs (e.g. ``[[19.26, 72.98], ...]``)
         — the Zepto training dataset uses this format.
    """
    if not encoded:
        return []
    s = encoded.strip()
    if not s:
        return []
    # JSON-array format
    if s.startswith("["):
        try:
            import json as _json
            arr = _json.loads(s)
            pts: list[tuple[float, float]] = []
            for item in arr:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    lat = float(item[0]); lng = float(item[1])
                    pts.append((lat, lng))
            return pts
        except Exception:
            return []
    # Google encoded polyline
    try:
        return _polyline.decode(s)
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


def detect_halt_clusters(encoded: str | None, radius_m: float = 100.0,
                          min_run_length: int = 5,
                          max_clusters: int = 20) -> list[dict]:
    """Find spatial clusters where consecutive pings stay within ``radius_m``.

    Returns one cluster per detected halt with {lat, lng, ping_count}.
    ``ping_count`` proxies dwell duration since per-ping timestamps aren't
    encoded in the polyline.

    Filtered to clusters with at least ``min_run_length`` consecutive close
    pings (a short dwell of 5+ pings). Top ``max_clusters`` by size.
    """
    pts = decode_polyline(encoded)
    if len(pts) < min_run_length:
        return []
    clusters = []
    current = [pts[0]]
    radius_km = radius_m / 1000.0
    for p in pts[1:]:
        # Compare to current cluster centroid.
        c_lat = sum(c[0] for c in current) / len(current)
        c_lng = sum(c[1] for c in current) / len(current)
        if haversine_km(p[0], p[1], c_lat, c_lng) <= radius_km:
            current.append(p)
        else:
            if len(current) >= min_run_length:
                lat = sum(c[0] for c in current) / len(current)
                lng = sum(c[1] for c in current) / len(current)
                clusters.append({"lat": round(lat, 6), "lng": round(lng, 6),
                                 "ping_count": len(current)})
            current = [p]
    if len(current) >= min_run_length:
        lat = sum(c[0] for c in current) / len(current)
        lng = sum(c[1] for c in current) / len(current)
        clusters.append({"lat": round(lat, 6), "lng": round(lng, 6),
                         "ping_count": len(current)})
    clusters.sort(key=lambda c: -c["ping_count"])
    return clusters[:max_clusters]


def polyline_endpoints(encoded: str | None) -> dict:
    """Return {origin_lat, origin_lng, dest_lat, dest_lng} from polyline ends."""
    pts = decode_polyline(encoded)
    if len(pts) < 2:
        return {"origin_lat": None, "origin_lng": None,
                "dest_lat": None, "dest_lng": None}
    return {
        "origin_lat": round(pts[0][0], 6), "origin_lng": round(pts[0][1], 6),
        "dest_lat": round(pts[-1][0], 6), "dest_lng": round(pts[-1][1], 6),
    }


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


def _count_alerts(v: Any) -> int:
    """Source `window_alerts` is comma-separated text like
    'detention_origin,route_deviation,sta_breach' OR plain text ('untracked')
    OR numeric. Return a count of distinct alert tokens.
    """
    if v is None:
        return 0
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        try:
            if isinstance(v, float) and math.isnan(v):
                return 0
            return int(v) if v > 0 else 0
        except (TypeError, ValueError):
            return 0
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return 0
        # Try numeric first.
        try:
            n = float(s)
            return int(n) if n > 0 else 0
        except ValueError:
            pass
        tokens = [t.strip() for t in s.split(",") if t.strip()]
        return len(tokens)
    return 0


def _safe_int(v: Any, default: int = 0) -> int:
    """Coerce to int, parsing numeric strings; default for None/NaN/non-numeric."""
    if v is None:
        return default
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        try:
            if isinstance(v, float) and math.isnan(v):
                return default
            return int(v)
        except (TypeError, ValueError):
            return default
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return default
        try:
            return int(float(s))
        except (TypeError, ValueError):
            return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _safe_datetime(v: Any) -> datetime | None:
    """Parse a value into a Python datetime, or None for NaT/NaN/missing/invalid."""
    if v is None:
        return None
    # pandas NaT / numeric NaN guard
    if isinstance(v, float) and math.isnan(v):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, datetime):
        return v
    if isinstance(v, pd.Timestamp):
        try:
            return v.to_pydatetime()
        except Exception:
            return None
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            ts = pd.to_datetime(s, errors="coerce")
        except Exception:
            return None
        if ts is pd.NaT or pd.isna(ts):
            return None
        try:
            return ts.to_pydatetime()
        except Exception:
            return None
    return None


def _is_present(v: Any) -> bool:
    """True if value is non-null / not NaN / not NaT / not empty string."""
    if v is None:
        return False
    if isinstance(v, float) and math.isnan(v):
        return False
    try:
        if pd.isna(v):
            return False
    except (TypeError, ValueError):
        pass
    if isinstance(v, str) and not v.strip():
        return False
    return True


def _first_token(v: Any) -> str:
    """First whitespace-delimited token of a string, or empty if missing."""
    s = _safe_str(v, "").strip()
    if not s:
        return ""
    return s.split()[0]


def _tracking_sources_count(s: str) -> int:
    """Count distinct comma-separated sources. Empty → 1 (assume single source)."""
    if not s or not s.strip():
        return 1
    tokens = [t.strip() for t in s.split(",") if t.strip()]
    if not tokens:
        return 1
    return len(set(tokens))


def extract_trip_features(row: dict | Any) -> dict:
    """Pull a flat feature dict from a trip row.

    Accepts a pandas row, dict, or any mapping. Missing fields → safe defaults.
    """
    g = row.get if isinstance(row, dict) else (lambda k, d=None: getattr(row, k, d) if hasattr(row, k) else row[k] if k in row else d)

    polyline_enc = _safe_str(g("ping_polyline", ""))
    poly_len = polyline_length_km(polyline_enc)
    transit_km = _safe_float(g("window_distance_travelled_km"))
    google_km = _safe_float(g("window_google_distance_km"))

    # Geo for map rendering: endpoints from polyline + spatial halt clusters.
    endpoints = polyline_endpoints(polyline_enc) if polyline_enc else {
        "origin_lat": None, "origin_lng": None, "dest_lat": None, "dest_lng": None,
    }
    halt_clusters = detect_halt_clusters(polyline_enc) if polyline_enc else []

    # --- Datetime / behavioural fields ---------------------------------------
    gate_out_dt = _safe_datetime(g("window_gate_out"))
    first_ping_dt = _safe_datetime(g("window_first_ping_outside_origin"))
    destination_entry_raw = g("window_destination_entry")
    destination_entry_dt = _safe_datetime(destination_entry_raw)
    closure_dt = _safe_datetime(g("window_trip_closure_time"))
    google_eta_dt = _safe_datetime(g("window_google_eta"))

    gate_out_hour = gate_out_dt.hour if gate_out_dt is not None else -1
    if gate_out_dt is not None and first_ping_dt is not None:
        gate_to_first_ping_min = (first_ping_dt - gate_out_dt).total_seconds() / 60.0
    else:
        gate_to_first_ping_min = 0.0

    if google_eta_dt is not None and closure_dt is not None:
        eta_breach_hrs = (closure_dt - google_eta_dt).total_seconds() / 3600.0
        if eta_breach_hrs < 0:
            eta_breach_hrs = 0.0
    else:
        eta_breach_hrs = 0.0

    tracking_sources_raw = _safe_str(g("window_tracking_sources", "")).lower()

    origin_raw = _safe_str(g("window_origin", ""))
    destination_raw = _safe_str(g("window_destination", ""))

    def _iso(dt):
        return dt.isoformat(timespec="seconds") if dt is not None else None

    return {
        "trip_id": _safe_str(g("window_trip_id", "")),
        "vehicle": _safe_str(g("vehicle_number_clean", "")),
        "driver_number": _safe_str(g("window_driver_number", "")),
        "driver_name": _safe_str(g("window_driver_name", "")),
        "transporter": _safe_str(g("window_transporter", "")),
        "origin": origin_raw,
        "destination": destination_raw,
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
        # --- Behavioural / forward-looking fields ----------------------------
        "gate_out_hour": gate_out_hour,
        "gate_to_first_ping_min": gate_to_first_ping_min,
        "loading_time_hrs": _safe_float(g("window_loading_time_hrs")),
        "tracking_health": _safe_float(g("window_tracking_health"), default=1.0),
        "tracking_sources": tracking_sources_raw,
        "tracking_sources_count": _tracking_sources_count(tracking_sources_raw),
        "alerts_count": _count_alerts(g("window_alerts")),
        "alerts_text": _safe_str(g("window_alerts", "")),
        "eta_breach_hrs": eta_breach_hrs,
        "destination_entry_present": _is_present(destination_entry_raw),
        "origin_code": _first_token(origin_raw),
        "destination_code": _first_token(destination_raw),
        # --- Display-only timeline (ISO strings) -----------------------------
        "gate_out_iso": _iso(gate_out_dt),
        "first_ping_iso": _iso(first_ping_dt),
        "destination_entry_iso": _iso(destination_entry_dt),
        "closure_iso": _iso(closure_dt),
        "google_eta_iso": _iso(google_eta_dt),
        # --- Geo for map rendering -------------------------------------------
        "ping_polyline": polyline_enc,
        "origin_lat": endpoints["origin_lat"],
        "origin_lng": endpoints["origin_lng"],
        "destination_lat": endpoints["dest_lat"],
        "destination_lng": endpoints["dest_lng"],
        "halt_clusters": halt_clusters,
    }
