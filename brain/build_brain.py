"""CLI entry point — build the brain, and/or score arbitrary trip data.

Two modes:

    # Full pipeline: build codex + case_index from the training xlsx,
    # then score the training xlsx itself. Writes 4 JSONs to public/zepto/brain/.
    python -m brain.build_brain

    # Score-only: load the already-built codex + case_index from
    # public/zepto/brain/, then score an arbitrary trip-level file
    # (.xlsx or .csv) against them. Writes a separate JSON to
    # public/zepto/brain/scored_<basename>.json.
    python -m brain.build_brain --score path/to/new_trips.xlsx

The score-only mode is the forward-looking entry point: feed it any new
trip-level file with the same window_* schema, and the brain will catch
repeated patterns (signals + nearest-case retrieval) without rebuilding
the codex.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from datetime import datetime
from pathlib import Path

import pandas as pd

warnings.filterwarnings("ignore")

from brain import CODEX_VERSION
from brain.features import extract_trip_features
from brain.codex_builder import build_codex, write_codex
from brain.case_index import (
    build_case_index_from_xlsx, extract_case_routes, write_case_index,
)
from brain.scorer import score_dataset, rollup_by_entity


ROOT = Path(__file__).resolve().parents[1]
TRAINING_XLSX = ROOT / "zepto_theft_cases_base_data.xlsx"
OUT_DIR = ROOT / "stoppage-intelligence" / "frontend" / "public" / "zepto" / "brain"


def _load_blacklist(training_df: pd.DataFrame) -> dict:
    drivers = {str(d) for d in training_df["window_driver_number"].dropna().astype(str)}
    vehicles = {str(v).upper().replace(" ", "")
                for v in training_df["vehicle_number_clean"].dropna()}
    transporters = {str(t).lower().strip()
                    for t in training_df["window_transporter"].dropna()}
    return {"drivers": drivers, "vehicles": vehicles, "transporters": transporters}


def _load_trip_file(path: Path) -> pd.DataFrame:
    """Load any trip-level file (.xlsx, .xls, .csv). Schema must carry window_* columns."""
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(path)
    if suffix == ".csv":
        return pd.read_csv(path, low_memory=False)
    raise ValueError(f"Unsupported file extension: {suffix} (need .xlsx, .xls, or .csv)")


def build_full() -> None:
    """Full pipeline: train codex + case_index from xlsx, then score it."""
    print(f"=== brain build_brain · codex {CODEX_VERSION} · {datetime.utcnow().isoformat(timespec='seconds')} ===")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading training set: {TRAINING_XLSX.name}")
    training_df = pd.read_excel(TRAINING_XLSX)
    print(f"  → {len(training_df):,} positive-class trips")

    target_df = training_df
    print(f"Target dataset (same as training): {len(target_df):,} rows")

    positives = [extract_trip_features(r) for r in training_df.to_dict(orient="records")]
    negatives: list[dict] = []
    print(f"  → {len(positives):,} positives · {len(negatives):,} negatives")

    blacklist = _load_blacklist(training_df)
    training_meta = {
        "training_xlsx": TRAINING_XLSX.name,
        "positive_trips": len(positives),
        "negative_trips": len(negatives),
    }

    # Build case index FIRST so case_routes is available for codex training.
    print("Building case index from training xlsx (incident-closest trip per case)…")
    case_idx = build_case_index_from_xlsx(training_df, extract_trip_features)
    write_case_index(case_idx, OUT_DIR / "case_index.json")
    case_routes = extract_case_routes(case_idx)
    print(f"  → {len(case_idx['cases'])} cases indexed · {len(case_routes)} unique case routes")

    print("Building codex…")
    codex = build_codex(positives, negatives, blacklist, training_meta, case_routes=case_routes)
    write_codex(codex, OUT_DIR / "theft_codex.json")
    print(f"  → {len(codex['signals'])} signals shipped (weight ≥ 5)")

    print("Scoring target dataset…")
    target_records = target_df.to_dict(orient="records")
    scores = score_dataset(target_records, codex, case_idx["cases"], blacklist, case_routes=case_routes)
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


def score_only(input_path: Path) -> None:
    """Load existing codex + case_index, score an arbitrary trip file."""
    print(f"=== brain score-only · codex {CODEX_VERSION} · {datetime.utcnow().isoformat(timespec='seconds')} ===")
    codex_path = OUT_DIR / "theft_codex.json"
    case_idx_path = OUT_DIR / "case_index.json"
    if not codex_path.exists() or not case_idx_path.exists():
        print(f"[brain] ERROR: codex / case_index missing — run `python -m brain.build_brain` first.", file=sys.stderr)
        sys.exit(2)

    print(f"Loading codex: {codex_path.name}")
    codex = json.loads(codex_path.read_text())
    case_idx = json.loads(case_idx_path.read_text())
    case_routes = {tuple(r) for r in case_idx.get("case_routes", [])}
    print(f"  → {len(codex.get('signals', []))} signals · {len(case_idx.get('cases', []))} cases · {len(case_routes)} routes")

    print(f"Loading new trips: {input_path}")
    df = _load_trip_file(input_path)
    print(f"  → {len(df):,} rows")

    records = df.to_dict(orient="records")
    # No blacklist needed — entity signals are gone. Pass empty so the
    # blacklist context entry exists for any future signals that read it.
    scores = score_dataset(records, codex, case_idx["cases"],
                           blacklist={"drivers": set(), "vehicles": set(), "transporters": set()},
                           case_routes=case_routes)

    out_path = OUT_DIR / f"scored_{input_path.stem}.json"
    out_path.write_text(json.dumps({
        "version": CODEX_VERSION,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds"),
        "source_file": input_path.name,
        "scores": scores,
    }, indent=2))

    high = sum(1 for s in scores if s["tier"] == "high")
    medium = sum(1 for s in scores if s["tier"] == "medium")
    print(f"Wrote {out_path.relative_to(ROOT)} — {len(scores):,} trips scored · {high} high · {medium} medium")
    print("Done.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--score", type=str, default=None,
        help="Score an arbitrary trip-level file (.xlsx/.csv) against the existing codex + case_index instead of rebuilding."
    )
    args = parser.parse_args()
    if args.score:
        score_only(Path(args.score).resolve())
    else:
        build_full()


if __name__ == "__main__":
    main()
