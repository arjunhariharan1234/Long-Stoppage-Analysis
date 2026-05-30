"""Signal definitions for the theft brain.

Each signal is a dict with: id, name, category, weight (default before codex
re-weights), and an `evaluator` callable returning {"fires": bool, "evidence": dict}.

The codex builder loads this registry, runs each evaluator over the positive
training set + negative sample, and re-weights based on hit-rate vs false-match.
"""
from __future__ import annotations

from typing import Callable


# --- ping_pattern --------------------------------------------------------------

def _eval_detour_high(feats: dict) -> dict:
    ratio = feats.get("detour_ratio", 1.0)
    fires = ratio >= 1.25 and feats.get("transit_distance_km", 0) >= 20
    return {"fires": fires, "evidence": {"detour_ratio": round(ratio, 2)}}


def _eval_low_ping_density(feats: dict) -> dict:
    if not feats.get("polyline_available", False):
        return {"fires": False, "evidence": {}}
    length = feats.get("polyline_length_km", 0.0)
    pings = feats.get("ping_count", 0)
    if length < 10:
        return {"fires": False, "evidence": {}}
    density = pings / length
    fires = density < 0.5
    return {"fires": fires, "evidence": {"pings_per_km": round(density, 2)}}


# --- halt_signature ------------------------------------------------------------

def _eval_long_stoppage_share(feats: dict) -> dict:
    stop = feats.get("stoppage_hrs", 0.0)
    transit = feats.get("transit_time_hrs", 0.0)
    if transit <= 0:
        return {"fires": False, "evidence": {}}
    share = stop / transit
    fires = share >= 0.4 and stop >= 1.0
    return {"fires": fires, "evidence": {"stoppage_share": round(share, 2)}}


# --- entity_state (filled in Task 4) ------------------------------------------

# --- temporal (filled in Task 4) ----------------------------------------------

# --- geofence ------------------------------------------------------------------

def _eval_geofence_breached(feats: dict) -> dict:
    return {
        "fires": bool(feats.get("geofence_breached", False)),
        "evidence": {"geofence_breached": True},
    }


def _eval_transit_vs_google(feats: dict) -> dict:
    transit = feats.get("transit_distance_km", 0)
    google = feats.get("google_distance_km", 0)
    if google <= 0:
        return {"fires": False, "evidence": {}}
    delta = transit - google
    fires = delta >= 15
    return {"fires": fires, "evidence": {"excess_km": round(delta, 1)}}


# --- closure_anomaly -----------------------------------------------------------

def _eval_low_unloading(feats: dict) -> dict:
    unload = feats.get("unloading_time_hrs", 0.0)
    transit = feats.get("transit_time_hrs", 0.0)
    fires = unload < 0.1 and transit >= 1.0
    return {"fires": fires, "evidence": {"unloading_hrs": round(unload, 2)}}


def _eval_auto_closure_low_pings(feats: dict) -> dict:
    closure = feats.get("closure_mode", "")
    pings = feats.get("total_pings", 0)
    transit_km = feats.get("transit_distance_km", 0)
    if closure != "auto" or transit_km < 10:
        return {"fires": False, "evidence": {}}
    pings_per_km = pings / max(transit_km, 1)
    fires = pings_per_km < 1.0
    return {"fires": fires, "evidence": {"pings_per_km": round(pings_per_km, 2)}}


SIGNAL_REGISTRY: list[dict] = [
    {
        "id": "S-01",
        "name": "Significant detour (transit ≫ planned)",
        "category": "ping_pattern",
        "rationale": "Trip travelled >25% more than the Google route — off-route detour.",
        "source_cases": ["CT-001"],
        "default_weight": 15,
        "evaluator": _eval_detour_high,
    },
    {
        "id": "S-02",
        "name": "Low ping density per km",
        "category": "ping_pattern",
        "rationale": "Sparse pings over a long polyline — possible GPS tampering / detour cover.",
        "source_cases": ["CT-004"],
        "default_weight": 10,
        "evaluator": _eval_low_ping_density,
    },
    {
        "id": "S-03",
        "name": "Stoppage dominates transit time",
        "category": "halt_signature",
        "rationale": "Stoppage hours ≥ 40% of transit hours with min 1hr stoppage.",
        "source_cases": ["CT-001", "CT-004"],
        "default_weight": 20,
        "evaluator": _eval_long_stoppage_share,
    },
    {
        "id": "S-08",
        "name": "Geofence breached",
        "category": "geofence",
        "rationale": "Vehicle exited an allowed route corridor.",
        "source_cases": ["CT-001"],
        "default_weight": 18,
        "evaluator": _eval_geofence_breached,
    },
    {
        "id": "S-09",
        "name": "Transit distance far exceeds Google distance",
        "category": "geofence",
        "rationale": "Driven distance > planned + 15km.",
        "source_cases": ["CT-001"],
        "default_weight": 15,
        "evaluator": _eval_transit_vs_google,
    },
    {
        "id": "S-10",
        "name": "Suspicious low unloading time",
        "category": "closure_anomaly",
        "rationale": "Cargo offloaded in < 6 minutes after a multi-hour transit — likely concealed offload.",
        "source_cases": ["CT-001"],
        "default_weight": 22,
        "evaluator": _eval_low_unloading,
    },
    {
        "id": "S-11",
        "name": "Auto-closure with sparse pings",
        "category": "closure_anomaly",
        "rationale": "System closed the trip without proper ping coverage.",
        "source_cases": ["CT-004"],
        "default_weight": 18,
        "evaluator": _eval_auto_closure_low_pings,
    },
]


def evaluate_signal(signal: dict, feats: dict) -> dict:
    """Run a single signal's evaluator. Returns {fires, evidence, id, name, weight}."""
    out = signal["evaluator"](feats)
    return {
        "id": signal["id"],
        "name": signal["name"],
        "category": signal["category"],
        "weight": signal.get("weight", signal.get("default_weight", 10)),
        "fires": out["fires"],
        "evidence": out["evidence"],
    }


def evaluate_all_signals(feats: dict, signals: list[dict] | None = None) -> dict:
    """Apply every signal in the registry (or a passed list) to a feature dict.

    Returns {"score": int, "matched": [signal-dicts that fired]}.
    """
    pool = signals if signals is not None else SIGNAL_REGISTRY
    matched = []
    score = 0
    for sig in pool:
        result = evaluate_signal(sig, feats)
        if result["fires"]:
            matched.append(result)
            score += result["weight"]
    return {"score": score, "matched": matched}
