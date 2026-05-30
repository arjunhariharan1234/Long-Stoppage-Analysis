"""CLI entry point — read training data, build codex + case index, score target
dataset, write four JSON files to frontend/public/zepto/brain/.

Usage:
    python -m brain.build_brain

No arguments — all paths are hard-coded against the repo layout. The training
xlsx doubles as the target dataset: it is the only source we have that carries
the trip-level ``window_*`` schema the brain's feature extractor expects.
"""
from __future__ import annotations

import json
import warnings
from datetime import datetime
from pathlib import Path

import pandas as pd

warnings.filterwarnings("ignore")

from brain import CODEX_VERSION
from brain.features import extract_trip_features
from brain.codex_builder import build_codex, write_codex
from brain.case_index import build_case_index, write_case_index
from brain.scorer import score_dataset, rollup_by_entity


ROOT = Path(__file__).resolve().parents[1]
TRAINING_XLSX = ROOT / "zepto_theft_cases_base_data.xlsx"
CASES_JSON = ROOT / "confirmed_thefts" / "cases_parsed.json"
OUT_DIR = ROOT / "stoppage-intelligence" / "frontend" / "public" / "zepto" / "brain"


def _load_blacklist(training_df: pd.DataFrame) -> dict:
    drivers = {str(d) for d in training_df["window_driver_number"].dropna().astype(str)}
    vehicles = {str(v).upper().replace(" ", "")
                for v in training_df["vehicle_number_clean"].dropna()}
    transporters = {str(t).lower().strip()
                    for t in training_df["window_transporter"].dropna()}
    return {"drivers": drivers, "vehicles": vehicles, "transporters": transporters}


def main() -> None:
    print(f"=== brain build_brain · codex {CODEX_VERSION} · {datetime.utcnow().isoformat(timespec='seconds')} ===")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading training set: {TRAINING_XLSX.name}")
    training_df = pd.read_excel(TRAINING_XLSX)
    print(f"  → {len(training_df):,} positive-class trips")

    # The training xlsx is the only trip-level source we have. It carries the
    # window_* schema the feature extractor expects. The halt-event CSV is
    # event-level (1M rows, alert_lat / trip_id / driver_name) and produces
    # empty feature dicts — so we score the trips we have features for.
    target_df = training_df
    print(f"Target dataset (same as training): {len(target_df):,} rows")

    positives = [extract_trip_features(r) for r in training_df.to_dict(orient="records")]
    # No clean negative pool — see brain.codex_builder.build_codex.
    negatives: list[dict] = []
    print(f"  → {len(positives):,} positives · {len(negatives):,} negatives")

    blacklist = _load_blacklist(training_df)
    training_meta = {
        "training_xlsx": TRAINING_XLSX.name,
        "positive_trips": len(positives),
        "negative_trips": len(negatives),
    }

    print("Building codex…")
    codex = build_codex(positives, negatives, blacklist, training_meta)
    write_codex(codex, OUT_DIR / "theft_codex.json")
    print(f"  → {len(codex['signals'])} signals shipped (weight ≥ 5)")

    print("Building case index…")
    cases_raw = json.loads(CASES_JSON.read_text())
    if isinstance(cases_raw, dict):
        cases_raw = cases_raw.get("cases", [])
    case_idx = build_case_index(cases_raw)
    write_case_index(case_idx, OUT_DIR / "case_index.json")
    print(f"  → {len(case_idx['cases'])} cases indexed")

    print("Scoring target dataset…")
    target_records = target_df.to_dict(orient="records")
    scores = score_dataset(target_records, codex, case_idx["cases"], blacklist)
    (OUT_DIR / "brain_scores.json").write_text(json.dumps({
        "version": CODEX_VERSION,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        "scores": scores,
    }, indent=2))
    print(f"  → {len(scores):,} trips scored · {sum(1 for s in scores if s['tier'] == 'high'):,} high-tier")

    print("Rolling up by entity…")
    rollups = rollup_by_entity(scores)
    (OUT_DIR / "brain_entity_rollups.json").write_text(json.dumps({
        "version": CODEX_VERSION,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        **rollups,
    }, indent=2))
    print(f"  → drivers {len(rollups['drivers']):,} · vehicles {len(rollups['vehicles']):,} · transporters {len(rollups['transporters']):,}")

    print("Done.")


if __name__ == "__main__":
    main()
