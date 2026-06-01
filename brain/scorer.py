"""Scorer — apply codex + retrieve nearest cases for a trip.

Public surface:
  - score_trip(feats, codex, cases, context) → brain_scores entry
  - score_dataset(rows, codex, cases, blacklist) → list of entries
  - rollup_by_entity(scores) → entity rollup dict
"""
from __future__ import annotations

import math
from collections import defaultdict

from brain.case_index import SIGNATURE_FEATURES, build_signature_vector
from brain.features import extract_trip_features
from brain.signals import SIGNAL_REGISTRY, evaluate_signal


def _resolve_signal(codex_sig: dict) -> dict | None:
    """Look up the registry signal that the codex entry refers to (by id)."""
    for s in SIGNAL_REGISTRY:
        if s["id"] == codex_sig["id"]:
            return {**s, "weight": codex_sig.get("weight", s.get("default_weight", 10))}
    return None


def _evaluate_codex(codex: dict, feats: dict, ctx: dict) -> dict:
    matched = []
    score = 0
    for entry in codex.get("signals", []):
        sig = _resolve_signal(entry)
        if sig is None:
            continue
        result = evaluate_signal(sig, feats, ctx)
        if result["fires"]:
            matched.append(result)
            score += result["weight"]
    return {"score": score, "matched": matched}


def _feature_weights_from_codex(codex: dict) -> dict[str, float]:
    """Derive case-distance feature weights from codex signal weights.

    Feature weight = sum of codex weights for signals whose definition references
    that feature. Conservative static mapping below — keeps the implementation
    explicit; an analyst can edit the codex weights and rebuild.
    """
    SIG_FEATURE_MAP = {
        "S-01": ["detour_ratio"],
        "S-02": ["ping_density_per_km"],
        "S-03": ["stoppage_share", "max_halt_hrs"],
        "S-08": ["geofence_breached"],
        "S-09": ["detour_ratio", "transit_distance_km"],
        "S-10": ["unloading_time_hrs"],
        "S-11": ["ping_density_per_km"],
        "S-12": [],   # loading time — not in signature vector v1
        "S-13": [],   # tracking health — not in signature vector v1
        "S-14": [],   # gate-out delay — not in signature vector v1
        "S-15": [],   # destination entry — not in signature vector v1
        "S-16": [],   # ETA breach — not in signature vector v1
        "S-17": [],   # alerts — not in signature vector v1
        "S-18": [],   # night gate-out — not in signature vector v1
        "S-19": [],   # route match — set membership, not vector feature
    }
    weights = {f: 1.0 for f in SIGNATURE_FEATURES}  # floor
    for sig in codex.get("signals", []):
        for f in SIG_FEATURE_MAP.get(sig["id"], []):
            weights[f] = weights.get(f, 0.0) + float(sig.get("weight", 0))
    return weights


def weighted_euclidean(a: dict, b: dict, weights: dict[str, float]) -> float:
    """Weighted Euclidean distance over SIGNATURE_FEATURES, min-max normalised to [0,1] inputs."""
    total = 0.0
    for f in SIGNATURE_FEATURES:
        w = weights.get(f, 1.0)
        diff = a.get(f, 0.0) - b.get(f, 0.0)
        total += w * diff * diff
    return math.sqrt(total)


def _tier(score: int) -> str:
    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    return "low"


MAX_PER_TRANSPORTER = 2  # Spec §11: cap retrievals from a single transporter.


def nearest_cases(trip_vec: dict, cases: list[dict], weights: dict[str, float],
                  k: int = 3) -> list[dict]:
    if not cases:
        return []
    distances = []
    for c in cases:
        d = weighted_euclidean(trip_vec, c["signature_vector"], weights)
        distances.append((d, c))
    if not distances:
        return []
    max_d = max(d for d, _ in distances) or 1.0
    distances.sort(key=lambda x: x[0])
    out = []
    transporter_counts: dict[str, int] = {}
    for d, c in distances:
        t = (c.get("transporter") or "").lower().strip()
        if t and transporter_counts.get(t, 0) >= MAX_PER_TRANSPORTER:
            continue
        transporter_counts[t] = transporter_counts.get(t, 0) + 1
        # Build a plain-English headline for the case so the UI doesn't need
        # to leak codified IDs into user-facing labels.
        city_str = c.get("city") or "an unknown city"
        transporter_str = c.get("transporter") or "an unknown transporter"
        loss = c.get("loss_inr")
        loss_str = (f" — ₹{int(loss):,} loss" if loss and loss > 0 else "")
        headline = f"Past theft incident in {city_str.title()} handled by {transporter_str}{loss_str}"
        out.append({
            "case_id": c.get("case_id"),
            "headline": headline,
            "similarity": round(max(0.0, 1.0 - d / max_d), 3),
            "city": c.get("city"),
            "transporter": c.get("transporter"),
            "rca_summary": c.get("rca_summary"),
        })
        if len(out) >= k:
            break
    return out


def score_trip(feats: dict, codex: dict, cases: list[dict], context: dict | None = None) -> dict:
    ctx = context or {}
    codex_result = _evaluate_codex(codex, feats, ctx)
    weights = _feature_weights_from_codex(codex)
    trip_vec = build_signature_vector(feats)
    similar = nearest_cases(trip_vec, cases, weights, k=3)

    # Enrich matched-signal payloads with human-readable text + rationale from the registry.
    from brain.signals import SIGNAL_REGISTRY
    sig_meta = {s["id"]: s for s in SIGNAL_REGISTRY}
    enriched_signals = []
    for m in codex_result["matched"]:
        reg = sig_meta.get(m["id"], {})
        enriched_signals.append({
            "id": m["id"],
            "name": m["name"],
            "category": m["category"],
            "weight": m["weight"],
            "evidence": m["evidence"],
            "human_text": reg.get("human_text", m["name"]),
            "short_text": reg.get("short_text", reg.get("human_text", m["name"])),
            "rationale": reg.get("rationale", ""),
        })

    return {
        # --- identity ---
        "trip_id": feats.get("trip_id"),
        "vehicle": feats.get("vehicle"),
        "driver_number": feats.get("driver_number"),
        "driver_name": feats.get("driver_name"),
        "transporter": feats.get("transporter"),
        "origin": feats.get("origin"),
        "destination": feats.get("destination"),
        # --- scoring ---
        "brain_score": int(codex_result["score"]),
        "tier": _tier(codex_result["score"]),
        "matched_signals": enriched_signals,
        "similar_cases": similar,
        "recommended_action": _recommended_action(codex_result["matched"], similar),
        # --- timeline (ISO strings, frontend formats) ---
        "gate_out": feats.get("gate_out_iso"),
        "first_ping_outside_origin": feats.get("first_ping_iso"),
        "destination_entry": feats.get("destination_entry_iso"),
        "trip_closure_time": feats.get("closure_iso"),
        "google_eta": feats.get("google_eta_iso"),
        # --- operational stats ---
        "transit_distance_km": round(feats.get("transit_distance_km", 0), 1),
        "google_distance_km": round(feats.get("google_distance_km", 0), 1),
        "transit_time_hrs": round(feats.get("transit_time_hrs", 0), 2),
        "stoppage_hrs": round(feats.get("stoppage_hrs", 0), 2),
        "loading_time_hrs": round(feats.get("loading_time_hrs", 0), 2),
        "unloading_time_hrs": round(feats.get("unloading_time_hrs", 0), 2),
        "eta_breach_hrs": round(feats.get("eta_breach_hrs", 0), 2),
        "total_pings": feats.get("total_pings", 0),
        "alerts_text": feats.get("alerts_text", ""),
        "tracking_health": feats.get("tracking_health", 100),
        "closure_mode": feats.get("closure_mode", ""),
        # --- Geo for map rendering ---
        "ping_polyline": feats.get("ping_polyline", ""),
        "origin_lat": feats.get("origin_lat"),
        "origin_lng": feats.get("origin_lng"),
        "destination_lat": feats.get("destination_lat"),
        "destination_lng": feats.get("destination_lng"),
        "halt_clusters": feats.get("halt_clusters", []),
    }


def _recommended_action(matched: list[dict], similar: list[dict]) -> str:
    """Tiny canned recommender — points the analyst at the highest-leverage next step.

    Never leaks codified case IDs (CT-XXXXXX) — uses plain city/transporter language.
    """
    if not matched:
        return "No brain hit — review only if other surfaces flag."
    has_high_weight = any(m["weight"] >= 15 for m in matched)
    def _case_phrase(c: dict) -> str:
        city = (c.get("city") or "").strip()
        transporter = (c.get("transporter") or "").strip()
        if city and transporter:
            return f"the past {city} theft handled by {transporter}"
        if city:
            return f"the past theft in {city}"
        return "a past theft case"
    if has_high_weight and similar:
        c = similar[0]
        return (f"Open the evidence packet and cross-check against {_case_phrase(c)}.")
    if similar:
        c = similar[0]
        return (f"Compare the GPS pattern with {_case_phrase(c)} — "
                f"{int(c.get('similarity', 0) * 100)}% behavioural match.")
    return "Open the evidence packet."


def score_dataset(rows, codex: dict, cases: list[dict], blacklist: dict,
                   case_routes: set | None = None) -> list[dict]:
    ctx = {"blacklist": blacklist, "case_routes": case_routes or set()}
    out = []
    for r in rows:
        feats = extract_trip_features(r)
        out.append(score_trip(feats, codex, cases, ctx))
    _retier_by_percentile(out)
    return out


def _retier_by_percentile(scores: list[dict]) -> None:
    """Override absolute tiers with within-cohort percentile tiers.

    Top 20% → high, next 30% → medium, bottom 50% → low. For small cohorts
    (< 10 trips) the absolute tier from _tier() is kept as-is.
    """
    if len(scores) < 10:
        return
    ordered = sorted((s["brain_score"] for s in scores), reverse=True)
    p20 = ordered[int(len(ordered) * 0.20)]
    p50 = ordered[int(len(ordered) * 0.50)]
    for s in scores:
        if s["brain_score"] >= p20:
            s["tier"] = "high"
        elif s["brain_score"] >= p50:
            s["tier"] = "medium"
        else:
            s["tier"] = "low"


def rollup_by_entity(scores: list[dict]) -> dict:
    """Aggregate per-trip scores into per-driver, per-vehicle, per-transporter rollups."""
    def bucket(field: str) -> list[dict]:
        groups = defaultdict(list)
        for s in scores:
            key = s.get(field)
            if not key:
                continue
            groups[key].append(s)
        rows = []
        for key, items in groups.items():
            hits = [i for i in items if i["brain_score"] >= 40]
            risk = round(sum(i["brain_score"] for i in items) / max(len(items), 1))
            sig_counter = defaultdict(int)
            for i in items:
                for m in i["matched_signals"]:
                    sig_counter[m["id"]] += 1
            top_sigs = sorted(sig_counter.items(), key=lambda kv: -kv[1])[:3]
            rows.append({
                field: key,
                "trips": len(items),
                "trips_with_brain_hit": len(hits),
                "risk_score": risk,
                "top_signal_ids": [s for s, _ in top_sigs],
            })
        rows.sort(key=lambda r: -r["risk_score"])
        return rows

    return {
        "drivers": bucket("driver_number"),
        "vehicles": bucket("vehicle"),
        "transporters": bucket("transporter"),
    }
