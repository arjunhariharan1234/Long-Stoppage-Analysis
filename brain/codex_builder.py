"""Codex builder — derive weighted signal definitions from training data.

Given:
  - positives: list of feature-dicts for known-bad trips (confirmed thefts +
    blacklisted-entity trips).
  - negatives: list of feature-dicts for a sample of fleet trips that are NOT
    in the positive set.
  - blacklist: {drivers, vehicles, transporters} — string sets used by entity signals.

Produces theft_codex.json shape:
  {version, generated_at, training_set, signals: [{id, name, category, weight,
   training_hit_rate, false_match_proxy, source_cases, rationale, default_weight}]}
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Iterable

from brain import CODEX_VERSION
from brain.signals import SIGNAL_REGISTRY, evaluate_signal


MIN_SHIPPABLE_WEIGHT = 5
SINGLE_CASE_WEIGHT_CAP = 10  # Signals citing fewer than 2 source cases cap here.


def compute_weight(hit_rate: float, false_match: float) -> int:
    """weight = round(100 * (hit_rate - false_match)), floored at 0."""
    w = round(100 * (hit_rate - false_match))
    return max(0, int(w))


def _apply_overfit_guard(weight: int, source_cases: list[str]) -> int:
    """Spec §11: cap weight at SINGLE_CASE_WEIGHT_CAP when a signal cites <2 cases."""
    if len(source_cases or []) < 2:
        return min(weight, SINGLE_CASE_WEIGHT_CAP)
    return weight


def _hit_rate(signal: dict, rows: Iterable[dict], ctx: dict) -> float:
    rows = list(rows)
    if not rows:
        return 0.0
    fired = 0
    for r in rows:
        if evaluate_signal(signal, r, ctx)["fires"]:
            fired += 1
    return fired / len(rows)


def build_codex(positives: list[dict], negatives: list[dict], blacklist: dict,
                training_meta: dict | None = None) -> dict:
    """Build the codex by training each signal against positive vs negative sets."""
    ctx = {"blacklist": blacklist}
    signals_out = []
    for sig in SIGNAL_REGISTRY:
        hit = _hit_rate(sig, positives, ctx)
        fm = _hit_rate(sig, negatives, ctx)
        weight = compute_weight(hit, fm)
        weight = _apply_overfit_guard(weight, sig.get("source_cases", []))
        if weight < MIN_SHIPPABLE_WEIGHT:
            continue
        signals_out.append({
            "id": sig["id"],
            "name": sig["name"],
            "category": sig["category"],
            "rationale": sig["rationale"],
            "source_cases": sig.get("source_cases", []),
            "default_weight": sig.get("default_weight", 10),
            "weight": weight,
            "training_hit_rate": round(hit, 3),
            "false_match_proxy": round(fm, 3),
        })
    return {
        "version": CODEX_VERSION,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        "training_set": training_meta or {},
        "signals": signals_out,
    }


def write_codex(codex: dict, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(codex, indent=2))
