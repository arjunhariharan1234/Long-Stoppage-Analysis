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


# --- temporal ------------------------------------------------------------------

def _eval_slow_loading(feats: dict) -> dict:
    loading = feats.get("loading_time_hrs", 0.0) or 0.0
    fires = loading >= 3.0
    return {"fires": fires, "evidence": {"loading_time_hrs": round(loading, 2)}}


def _eval_night_gate_out(feats: dict) -> dict:
    hour = feats.get("gate_out_hour", -1)
    fires = hour in (22, 23, 0, 1, 2, 3)
    return {"fires": fires, "evidence": {"gate_out_hour": hour}}


# --- tracking ------------------------------------------------------------------

def _eval_tracking_health_degraded(feats: dict) -> dict:
    """tracking_health is on a 0-100 scale in the source data.
    Fires when health is meaningfully degraded (< 70)."""
    health = feats.get("tracking_health", 100.0)
    # Tolerate either scale: if a caller passed 0-1, scale up before comparing.
    if 0 < health <= 1.0:
        health = health * 100
    fires = health < 70.0
    return {"fires": fires, "evidence": {"tracking_health": round(health, 2)}}


def _eval_gate_to_first_ping_delay(feats: dict) -> dict:
    delay = feats.get("gate_to_first_ping_min", 0.0) or 0.0
    fires = delay >= 30
    return {"fires": fires, "evidence": {"gate_to_first_ping_min": round(delay, 1)}}


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
    """Source data uses 'Auto Closed' (titlecase, with space). Match permissively."""
    closure = (feats.get("closure_mode", "") or "").lower()
    pings = feats.get("total_pings", 0)
    transit_km = feats.get("transit_distance_km", 0)
    is_auto = "auto" in closure
    if not is_auto or transit_km < 10:
        return {"fires": False, "evidence": {}}
    pings_per_km = pings / max(transit_km, 1)
    fires = pings_per_km < 1.0
    return {"fires": fires, "evidence": {"pings_per_km": round(pings_per_km, 2), "closure_mode": closure}}


def _eval_destination_entry_missing(feats: dict) -> dict:
    present = bool(feats.get("destination_entry_present", False))
    transit_km = feats.get("transit_distance_km", 0) or 0
    fires = (not present) and transit_km >= 5
    return {
        "fires": fires,
        "evidence": {
            "destination_entry_present": present,
            "transit_distance_km": round(float(transit_km), 1),
        },
    }


def _eval_eta_breach(feats: dict) -> dict:
    breach = feats.get("eta_breach_hrs", 0.0) or 0.0
    fires = breach >= 4.0
    return {"fires": fires, "evidence": {"eta_breach_hrs": round(breach, 2)}}


# --- ping_pattern (alerts) -----------------------------------------------------

def _eval_alerts_fired(feats: dict) -> dict:
    count = feats.get("alerts_count", 0) or 0
    fires = count >= 1
    return {"fires": fires, "evidence": {"alerts_count": int(count)}}


SIGNAL_REGISTRY: list[dict] = [
    {
        "id": "S-01",
        "name": "Significant detour (transit ≫ planned)",
        "category": "ping_pattern",
        "rationale": "Trip travelled >25% more than the Google route — off-route detour.",
        "human_text": "The truck drove much further than the planned route — at least 25% extra distance. That kind of detour usually means an unscheduled stop or a route swap mid-trip.",
        "short_text": "Drove much further than planned (25%+ extra distance)",
        "source_cases": ["CT-001"],
        "default_weight": 15,
        "evaluator": _eval_detour_high,
    },
    {
        "id": "S-02",
        "name": "Low ping density per km",
        "category": "ping_pattern",
        "rationale": "Sparse pings over a long polyline — possible GPS tampering / detour cover.",
        "human_text": "GPS pings were unusually sparse for the distance covered. The device may have been turned off or jammed during parts of the journey.",
        "short_text": "GPS pings unusually sparse — device may have been off",
        "source_cases": ["CT-004"],
        "default_weight": 10,
        "evaluator": _eval_low_ping_density,
    },
    {
        "id": "S-03",
        "name": "Stoppage dominates transit time",
        "category": "halt_signature",
        "rationale": "Stoppage hours ≥ 40% of transit hours with min 1hr stoppage.",
        "human_text": "The truck spent more time stopped than moving — over 40% of the trip was stationary. That much halt time on a delivery run is unusual.",
        "short_text": "40%+ of the trip was stationary",
        "source_cases": ["CT-001", "CT-004"],
        "default_weight": 20,
        "evaluator": _eval_long_stoppage_share,
    },
    {
        "id": "S-08",
        "name": "Geofence breached",
        "category": "geofence",
        "rationale": "Vehicle exited an allowed route corridor.",
        "human_text": "The vehicle left its allowed corridor — the platform's geofence was breached during the trip.",
        "short_text": "Vehicle left its allowed corridor (geofence breach)",
        "source_cases": ["CT-001"],
        "default_weight": 18,
        "evaluator": _eval_geofence_breached,
    },
    {
        "id": "S-09",
        "name": "Transit distance far exceeds Google distance",
        "category": "geofence",
        "rationale": "Driven distance > planned + 15km.",
        "human_text": "The truck drove at least 15km more than the planned distance. On a short city run, that's a significant detour off the optimal route.",
        "short_text": "Drove 15+ km more than planned",
        "source_cases": ["CT-001"],
        "default_weight": 15,
        "evaluator": _eval_transit_vs_google,
    },
    {
        "id": "S-10",
        "name": "Suspicious low unloading time",
        "category": "closure_anomaly",
        "rationale": "Cargo offloaded in < 6 minutes after a multi-hour transit — likely concealed offload.",
        "human_text": "The cargo was 'unloaded' in under 6 minutes after a multi-hour transit. That's too fast for legitimate offload — usually means the cargo wasn't actually delivered, or was already gone.",
        "short_text": "Cargo 'unloaded' in under 6 minutes",
        "source_cases": ["CT-001"],
        "default_weight": 22,
        "evaluator": _eval_low_unloading,
    },
    {
        "id": "S-11",
        "name": "Auto-closure with sparse pings",
        "category": "closure_anomaly",
        "rationale": "System closed the trip without proper ping coverage.",
        "human_text": "The trip auto-closed without proper ping coverage. The system couldn't actually confirm the truck reached the destination — it just timed out.",
        "short_text": "Trip auto-closed without proper tracking",
        "source_cases": ["CT-004"],
        "default_weight": 18,
        "evaluator": _eval_auto_closure_low_pings,
    },
    {
        "id": "S-12",
        "name": "Slow loading at origin",
        "category": "temporal",
        "rationale": "Loading dwell ≥ 3h suggests pre-trip tampering or substitution window.",
        "human_text": "Loading at the origin took 3+ hours — much longer than normal. That extended dwell is a window where cargo can be swapped or tampered with before the trip even starts.",
        "short_text": "Loading at origin took 3+ hours",
        "source_cases": ["CT-0054448970"],
        "default_weight": 12,
        "evaluator": _eval_slow_loading,
    },
    {
        "id": "S-13",
        "name": "Tracking health degraded",
        "category": "tracking",
        "rationale": "Tracking-health score < 0.7 — pings unreliable; theft window can hide here.",
        "human_text": "GPS tracking quality was poor for this trip. When tracking degrades, there's a blind spot where the truck's actual location and activity can't be verified.",
        "short_text": "GPS tracking quality was poor",
        "source_cases": ["CT-0049047489"],
        "default_weight": 15,
        "evaluator": _eval_tracking_health_degraded,
    },
    {
        "id": "S-14",
        "name": "Gate-out to first-ping delay",
        "category": "tracking",
        "rationale": "≥30 min between gate-out and first ping outside origin — likely device-off / tampering.",
        "human_text": "GPS started reporting 30+ minutes after the truck physically left the origin. That's enough time to swap drivers or cargo with no tracking record.",
        "short_text": "GPS started reporting 30+ min after departure",
        "source_cases": ["CT-0054448970"],
        "default_weight": 20,
        "evaluator": _eval_gate_to_first_ping_delay,
    },
    {
        "id": "S-15",
        "name": "Destination entry missing",
        "category": "closure_anomaly",
        "rationale": "Trip closed without a destination-geofence entry event on a non-trivial trip.",
        "human_text": "There's no record of the truck actually arriving at the destination. The trip was closed without a confirmed dock-in event.",
        "short_text": "No arrival recorded at destination",
        "source_cases": ["CT-0051603091"],
        "default_weight": 15,
        "evaluator": _eval_destination_entry_missing,
    },
    {
        "id": "S-16",
        "name": "ETA breached significantly",
        "category": "closure_anomaly",
        "rationale": "Trip closure ≥4h past the Google ETA — extended off-route or unaccounted dwell.",
        "human_text": "The trip arrived 4+ hours after the planned ETA — far beyond normal traffic variance. That much delay usually means an unaccounted detour or extended stop.",
        "short_text": "Arrived 4+ hours after planned ETA",
        "source_cases": ["CT-0050982352"],
        "default_weight": 12,
        "evaluator": _eval_eta_breach,
    },
    {
        "id": "S-17",
        "name": "Alerts fired during trip",
        "category": "ping_pattern",
        "rationale": "One or more in-transit alerts (geofence, halt, route-deviation) raised by the platform.",
        "human_text": "The platform raised one or more alerts during this trip — halts, route deviations or geofence breaches that operations should have looked at.",
        "short_text": "Platform alerts raised during the trip",
        "source_cases": ["CT-0054448970"],
        "default_weight": 10,
        "evaluator": _eval_alerts_fired,
    },
    {
        "id": "S-18",
        "name": "Night gate-out",
        "category": "temporal",
        "rationale": "Gate-out between 22:00 and 03:59 — overnight starts skew theft-positive.",
        "human_text": "Trip departed between 10pm and 4am — a low-supervision window. Overnight starts statistically correlate with theft attempts.",
        "short_text": "Departed between 10pm and 4am",
        "source_cases": ["CT-0051902413"],
        "default_weight": 12,
        "evaluator": _eval_night_gate_out,
    },
    {
        "id": "S-19",
        "name": "Route matches a known theft case",
        "category": "geographic_memory",
        "rationale": "Same (origin_code, destination_code) pair as a confirmed theft incident — geographic-level repeat pattern.",
        "human_text": "This origin → destination route has been hit before. A past confirmed theft happened on the exact same lane.",
        "short_text": "Same route as a past confirmed theft",
        "source_cases": ["CT-0054448970", "CT-0049142973"],
        "default_weight": 25,
        "evaluator": None,  # bound below; needs ctx['case_routes']
    },
]


def _eval_route_matches_known_case(feats: dict, ctx: dict) -> dict:
    """Fires when the trip's (origin_code, destination_code) is in ctx['case_routes']."""
    routes = ctx.get("case_routes") or set()
    o = feats.get("origin_code") or ""
    d = feats.get("destination_code") or ""
    if not o or not d:
        return {"fires": False, "evidence": {}}
    if not isinstance(routes, set):
        routes = set(tuple(r) for r in routes)
    fires = (o, d) in routes
    return {"fires": fires, "evidence": {"origin": o, "destination": d}}


# Wire the deferred evaluator now that the function exists.
for _s in SIGNAL_REGISTRY:
    if _s["id"] == "S-19":
        _s["evaluator"] = _eval_route_matches_known_case


def evaluate_signal(signal: dict, feats: dict, context: dict | None = None) -> dict:
    """Run a single signal's evaluator. Returns {fires, evidence, id, name, weight}."""
    ctx = context or {}
    evaluator = signal["evaluator"]
    # Backwards-compat: evaluators that only take feats still work.
    try:
        out = evaluator(feats, ctx)
    except TypeError:
        out = evaluator(feats)
    return {
        "id": signal["id"],
        "name": signal["name"],
        "category": signal["category"],
        "weight": signal.get("weight", signal.get("default_weight", 10)),
        "fires": out["fires"],
        "evidence": out["evidence"],
    }


def evaluate_all_signals(feats: dict, signals: list[dict] | None = None,
                          context: dict | None = None) -> dict:
    """Apply every signal in the registry (or a passed list) to a feature dict.

    Returns {"score": int, "matched": [signal-dicts that fired]}.
    """
    pool = signals if signals is not None else SIGNAL_REGISTRY
    matched = []
    score = 0
    for sig in pool:
        result = evaluate_signal(sig, feats, context)
        if result["fires"]:
            matched.append(result)
            score += result["weight"]
    return {"score": score, "matched": matched}
