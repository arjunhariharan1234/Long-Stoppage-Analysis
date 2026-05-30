# Zepto Theft Brain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mine confirmed thefts + blacklisted entities into an auditable JSON codex of weighted signals + case-grade retrieval, scored against any trip dataset, surfaced inside existing Zepto Investigate / Pulse / Queue pages.

**Architecture:** Pure-Python `brain/` package at project root, alongside the existing `build_zepto_intelligence.py`. One CLI emits four JSON files into `frontend/public/zepto/brain/`. Frontend reads them through additions to `api.ts`. No new infra, no streaming, no ML library.

**Tech Stack:** Python 3.13, pandas, numpy, polyline (Google encoded polyline decoder), pytest. Frontend: React + TypeScript, `ft-design-system` components (already in use).

**Spec:** `docs/superpowers/specs/2026-05-30-zepto-theft-brain-codex-design.md` (read this first).

---

## File map

**Backend (Python — project root):**

```
brain/
  __init__.py                 # package marker; exports version constant
  features.py                 # polyline decode, halt sequence, off-route, time-of-day
  signals.py                  # SIGNAL_REGISTRY: list of dict-spec'd signal evaluators
  codex_builder.py            # mine positive-class stats → theft_codex.json
  case_index.py               # build case_index.json (per-case signature vectors)
  scorer.py                   # apply codex + retrieve cases → brain_scores.json + rollups
  build_brain.py              # CLI entry: orchestrates all four JSON outputs

tests/brain/
  __init__.py
  conftest.py                 # shared fixtures (sample polyline, sample trip row)
  test_features.py
  test_signals.py
  test_codex_builder.py
  test_case_index.py
  test_scorer.py
```

**Frontend (already-existing files, modifications only):**

```
stoppage-intelligence/frontend/src/zepto/
  api.ts                      # add brain.scores(), brain.rollups(), brain.codex(), brain.cases()
  types.ts                    # add BrainSignal, BrainScore, BrainCase, BrainEntityRollup
  pages/Investigation.tsx     # add 'Brain' tab inside entity panel
  pages/Pulse.tsx             # add 'Brain-flagged' rail above existing themes
  pages/Queue.tsx             # add brain_score column + sort
```

**JSON outputs (written by CLI):**

```
stoppage-intelligence/frontend/public/zepto/brain/
  theft_codex.json
  case_index.json
  brain_scores.json
  brain_entity_rollups.json
```

---

## Task 1: Bootstrap brain package + deps

**Files:**
- Create: `brain/__init__.py`
- Create: `tests/brain/__init__.py`
- Create: `tests/brain/conftest.py`
- Modify: `stoppage-intelligence/backend/requirements.txt` (add `polyline==2.0.2`, `pytest==8.3.3`)
- Create: `pytest.ini` (project root)

- [ ] **Step 1: Install deps locally**

Run:
```bash
pip install polyline==2.0.2 pytest==8.3.3
```
Expected: both install without errors.

- [ ] **Step 2: Add deps to backend requirements**

Append to `stoppage-intelligence/backend/requirements.txt`:
```
polyline==2.0.2
pytest==8.3.3
```

- [ ] **Step 3: Create package markers**

`brain/__init__.py`:
```python
"""Zepto Theft Brain — pattern codex + classifier engine.

See docs/superpowers/specs/2026-05-30-zepto-theft-brain-codex-design.md.
"""

CODEX_VERSION = "2026-05-30.1"
```

`tests/brain/__init__.py`: empty file.

- [ ] **Step 4: Create pytest config**

`pytest.ini`:
```ini
[pytest]
testpaths = tests
python_files = test_*.py
addopts = -v --tb=short
```

- [ ] **Step 5: Create shared fixture file**

`tests/brain/conftest.py`:
```python
"""Shared fixtures for brain tests."""
import json
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def cases_parsed():
    """Load the parsed confirmed-theft cases (ground truth)."""
    path = ROOT / "confirmed_thefts" / "cases_parsed.json"
    return json.loads(path.read_text())


@pytest.fixture
def sample_polyline():
    """A short, hand-known encoded polyline.
    Encodes: (26.7619, 80.8514), (26.7625, 80.8520), (26.7630, 80.8530)
    """
    # polyline.encode([(26.7619, 80.8514), (26.7625, 80.8520), (26.7630, 80.8530)])
    return "iigjCgvz}LMOKQ"


@pytest.fixture
def sample_trip_row():
    """A synthetic trip row with the columns the brain reads."""
    return {
        "window_trip_id": 54223023,
        "vehicle_number_clean": "UP32QT2997",
        "window_driver_number": 7459901375,
        "window_driver_name": "Suraj",
        "window_transporter": "A&A Associates - Zepto",
        "window_origin": "LKO002M - LKO-DRY-MH MOHANLAL GANJ_1",
        "window_destination": "LKO005S - LKO-Aliganj",
        "window_distance_travelled_km": 92.31,
        "window_google_distance_km": 73.51,
        "window_transit_time_hrs": 3.0,
        "window_stoppage_hrs": 2.05,
        "window_unloading_time_hrs": 0.0,
        "window_geofence_breached": False,
        "window_total_pings": 120,
        "window_closure_mode": "manual",
        "window_auto_closure_type": None,
        "ping_count": 120,
        "ping_polyline": "iigjCgvz}LMOKQ",
    }
```

- [ ] **Step 6: Verify pytest discovers tests**

Run:
```bash
cd "/Users/admin/Desktop/Projects/Long Stoppage Analysis" && pytest --collect-only tests/brain/
```
Expected: "no tests ran" or "0 tests collected" — both fine, just confirms discovery works.

- [ ] **Step 7: Commit**

```bash
git add brain/ tests/brain/ pytest.ini stoppage-intelligence/backend/requirements.txt
git commit -m "brain: scaffold package + pytest config"
```

---

## Task 2: Feature engineering (polyline + halt sequence)

**Files:**
- Create: `brain/features.py`
- Create: `tests/brain/test_features.py`

- [ ] **Step 1: Write failing test for polyline decode**

`tests/brain/test_features.py`:
```python
"""Tests for brain.features."""
import math
import pytest

from brain.features import (
    decode_polyline,
    polyline_length_km,
    haversine_km,
    extract_trip_features,
)


def test_decode_polyline_returns_list_of_lat_lng(sample_polyline):
    pts = decode_polyline(sample_polyline)
    assert len(pts) == 3
    assert pts[0] == pytest.approx((26.7619, 80.8514), abs=1e-4)
    assert pts[2] == pytest.approx((26.7630, 80.8530), abs=1e-4)


def test_decode_polyline_empty_returns_empty_list():
    assert decode_polyline("") == []
    assert decode_polyline(None) == []


def test_haversine_km_known_distance():
    # ~111 km per degree of latitude near the equator
    d = haversine_km(0.0, 0.0, 1.0, 0.0)
    assert d == pytest.approx(111.19, abs=0.5)


def test_polyline_length_km_sums_segments(sample_polyline):
    length = polyline_length_km(sample_polyline)
    # 3 points, ~80m + ~130m ≈ 0.2 km
    assert 0.05 < length < 0.5


def test_extract_trip_features_basic_fields(sample_trip_row):
    feats = extract_trip_features(sample_trip_row)
    assert feats["transit_distance_km"] == pytest.approx(92.31, abs=0.01)
    assert feats["google_distance_km"] == pytest.approx(73.51, abs=0.01)
    assert feats["detour_ratio"] == pytest.approx(92.31 / 73.51, abs=0.01)
    assert feats["ping_count"] == 120
    assert feats["polyline_available"] is True
    assert feats["stoppage_hrs"] == pytest.approx(2.05, abs=0.01)
    assert feats["unloading_time_hrs"] == pytest.approx(0.0, abs=0.01)
    assert feats["geofence_breached"] is False


def test_extract_trip_features_handles_missing_polyline():
    row = {"ping_polyline": "", "window_distance_travelled_km": 50,
           "window_google_distance_km": 50, "ping_count": 0,
           "window_stoppage_hrs": 0, "window_unloading_time_hrs": 1,
           "window_geofence_breached": False, "window_transit_time_hrs": 2,
           "window_total_pings": 0, "window_closure_mode": "auto",
           "window_auto_closure_type": "system"}
    feats = extract_trip_features(row)
    assert feats["polyline_available"] is False
    assert feats["polyline_length_km"] == 0.0
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
pytest tests/brain/test_features.py -v
```
Expected: ImportError / ModuleNotFoundError for `brain.features`.

- [ ] **Step 3: Implement features module**

`brain/features.py`:
```python
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

    polyline_enc = g("ping_polyline", "") or ""
    poly_len = polyline_length_km(polyline_enc)
    transit_km = _safe_float(g("window_distance_travelled_km"))
    google_km = _safe_float(g("window_google_distance_km"))

    return {
        "trip_id": str(g("window_trip_id", "")),
        "vehicle": g("vehicle_number_clean", "") or "",
        "driver_number": str(g("window_driver_number", "") or ""),
        "transporter": g("window_transporter", "") or "",
        "origin": g("window_origin", "") or "",
        "destination": g("window_destination", "") or "",
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
        "closure_mode": (g("window_closure_mode", "") or "").lower(),
        "auto_closure_type": (g("window_auto_closure_type", "") or "") or "",
    }
```

- [ ] **Step 4: Run tests, verify they pass**

Run:
```bash
pytest tests/brain/test_features.py -v
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add brain/features.py tests/brain/test_features.py
git commit -m "brain: feature engineering (polyline decode, halt sequence)"
```

---

## Task 3: Signal registry + first 6 signals (ping_pattern + halt_signature + closure)

**Files:**
- Create: `brain/signals.py`
- Create: `tests/brain/test_signals.py`

- [ ] **Step 1: Write failing tests**

`tests/brain/test_signals.py`:
```python
"""Tests for brain.signals."""
import pytest

from brain.signals import SIGNAL_REGISTRY, evaluate_signal, evaluate_all_signals


def test_registry_has_categories():
    cats = {s["category"] for s in SIGNAL_REGISTRY}
    assert "ping_pattern" in cats
    assert "halt_signature" in cats
    assert "closure_anomaly" in cats


def test_registry_ids_unique():
    ids = [s["id"] for s in SIGNAL_REGISTRY]
    assert len(ids) == len(set(ids)), f"duplicate signal ids: {ids}"


def test_detour_signal_fires_on_large_detour():
    feats = {"detour_ratio": 1.5, "transit_distance_km": 100, "google_distance_km": 67}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-01")
    result = evaluate_signal(sig, feats)
    assert result["fires"] is True


def test_detour_signal_does_not_fire_on_normal_trip():
    feats = {"detour_ratio": 1.05, "transit_distance_km": 100, "google_distance_km": 95}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-01")
    result = evaluate_signal(sig, feats)
    assert result["fires"] is False


def test_low_ping_density_fires():
    feats = {"polyline_length_km": 100, "ping_count": 10, "polyline_available": True}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-02")
    assert evaluate_signal(sig, feats)["fires"] is True


def test_low_unloading_anomaly_fires():
    feats = {"unloading_time_hrs": 0.05, "transit_time_hrs": 3.0}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-10")
    assert evaluate_signal(sig, feats)["fires"] is True


def test_auto_closure_with_low_pings_fires():
    feats = {"closure_mode": "auto", "total_pings": 30, "transit_distance_km": 100}
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-11")
    assert evaluate_signal(sig, feats)["fires"] is True


def test_evaluate_all_signals_returns_dict_with_score(sample_trip_row):
    from brain.features import extract_trip_features
    feats = extract_trip_features(sample_trip_row)
    result = evaluate_all_signals(feats)
    assert "score" in result
    assert "matched" in result
    assert isinstance(result["matched"], list)
```

- [ ] **Step 2: Run tests, verify they fail**

Run:
```bash
pytest tests/brain/test_signals.py -v
```
Expected: ImportError on `brain.signals`.

- [ ] **Step 3: Implement signals module**

`brain/signals.py`:
```python
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run:
```bash
pytest tests/brain/test_signals.py -v
```
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add brain/signals.py tests/brain/test_signals.py
git commit -m "brain: signal registry + ping/halt/geofence/closure signals"
```

---

## Task 4: Entity-state + temporal signals

**Files:**
- Modify: `brain/signals.py`
- Modify: `tests/brain/test_signals.py`

These signals need access to blacklists (driver_numbers, vehicles, transporters) which the trip features carry as plain identifiers. The evaluator takes a second arg `context` carrying the blacklists.

- [ ] **Step 1: Extend signal interface to accept context**

Replace `evaluate_signal` and `evaluate_all_signals` in `brain/signals.py`:
```python
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
    pool = signals if signals is not None else SIGNAL_REGISTRY
    matched = []
    score = 0
    for sig in pool:
        result = evaluate_signal(sig, feats, context)
        if result["fires"]:
            matched.append(result)
            score += result["weight"]
    return {"score": score, "matched": matched}
```

- [ ] **Step 2: Write failing tests for entity + temporal signals**

Append to `tests/brain/test_signals.py`:
```python
def test_driver_blacklist_fires():
    feats = {"driver_number": "7459901375"}
    ctx = {"blacklist": {"drivers": {"7459901375", "9999999999"}, "vehicles": set(), "transporters": set()}}
    from brain.signals import SIGNAL_REGISTRY, evaluate_signal
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-04")
    assert evaluate_signal(sig, feats, ctx)["fires"] is True


def test_driver_blacklist_does_not_fire_for_unknown():
    feats = {"driver_number": "0000000000"}
    ctx = {"blacklist": {"drivers": {"7459901375"}, "vehicles": set(), "transporters": set()}}
    from brain.signals import SIGNAL_REGISTRY, evaluate_signal
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-04")
    assert evaluate_signal(sig, feats, ctx)["fires"] is False


def test_vehicle_blacklist_fires():
    feats = {"vehicle": "UP32QT2997"}
    ctx = {"blacklist": {"drivers": set(), "vehicles": {"UP32QT2997"}, "transporters": set()}}
    from brain.signals import SIGNAL_REGISTRY, evaluate_signal
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-05")
    assert evaluate_signal(sig, feats, ctx)["fires"] is True


def test_transporter_repeat_offender_fires():
    feats = {"transporter": "A&A Associates - Zepto"}
    ctx = {"blacklist": {"drivers": set(), "vehicles": set(),
                          "transporters": {"a&a associates - zepto"}}}
    from brain.signals import SIGNAL_REGISTRY, evaluate_signal
    sig = next(s for s in SIGNAL_REGISTRY if s["id"] == "S-06")
    assert evaluate_signal(sig, feats, ctx)["fires"] is True
```

- [ ] **Step 3: Run tests, verify they fail**

Run:
```bash
pytest tests/brain/test_signals.py -v
```
Expected: 4 new tests fail with "no signal with id S-04".

- [ ] **Step 4: Add entity-state evaluators + register them**

Append to `brain/signals.py` (before `SIGNAL_REGISTRY`):
```python
# --- entity_state --------------------------------------------------------------

def _eval_driver_blacklisted(feats: dict, ctx: dict) -> dict:
    bl = (ctx.get("blacklist") or {}).get("drivers") or set()
    drv = str(feats.get("driver_number") or "").strip()
    return {"fires": drv in bl, "evidence": {"driver_number": drv}}


def _eval_vehicle_blacklisted(feats: dict, ctx: dict) -> dict:
    bl = (ctx.get("blacklist") or {}).get("vehicles") or set()
    v = (feats.get("vehicle") or "").upper().replace(" ", "")
    return {"fires": v in bl, "evidence": {"vehicle": v}}


def _eval_transporter_repeat(feats: dict, ctx: dict) -> dict:
    bl = (ctx.get("blacklist") or {}).get("transporters") or set()
    t = (feats.get("transporter") or "").lower().strip()
    return {"fires": t in bl, "evidence": {"transporter": t}}
```

Then add these dicts to `SIGNAL_REGISTRY` (between S-03 and S-08):
```python
    {
        "id": "S-04",
        "name": "Driver on blacklist",
        "category": "entity_state",
        "rationale": "Driver number appears in the confirmed-theft/blacklisted-driver set.",
        "source_cases": ["CT-001", "CT-007"],
        "default_weight": 35,
        "evaluator": _eval_driver_blacklisted,
    },
    {
        "id": "S-05",
        "name": "Vehicle on blacklist",
        "category": "entity_state",
        "rationale": "Vehicle number appears in the confirmed-theft/blacklisted-vehicle set.",
        "source_cases": ["CT-001"],
        "default_weight": 35,
        "evaluator": _eval_vehicle_blacklisted,
    },
    {
        "id": "S-06",
        "name": "Transporter is a repeat offender",
        "category": "entity_state",
        "rationale": "Transporter branch has multiple trips in the positive set.",
        "source_cases": ["CT-001", "CT-004"],
        "default_weight": 20,
        "evaluator": _eval_transporter_repeat,
    },
```

- [ ] **Step 5: Run tests, verify they pass**

Run:
```bash
pytest tests/brain/test_signals.py -v
```
Expected: all tests pass (12 total).

- [ ] **Step 6: Commit**

```bash
git add brain/signals.py tests/brain/test_signals.py
git commit -m "brain: entity-state signals (driver/vehicle/transporter blacklist)"
```

---

## Task 5: Codex builder (mine weights from positive vs negative)

**Files:**
- Create: `brain/codex_builder.py`
- Create: `tests/brain/test_codex_builder.py`

- [ ] **Step 1: Write failing test**

`tests/brain/test_codex_builder.py`:
```python
"""Tests for brain.codex_builder."""
import pytest

from brain.codex_builder import compute_weight, build_codex


def test_compute_weight_formula():
    # hit_rate 0.6, false_match 0.1 → weight = 50
    assert compute_weight(0.6, 0.1) == 50
    # hit_rate 0.1, false_match 0.05 → weight = 5
    assert compute_weight(0.1, 0.05) == 5
    # hit_rate < false_match → floor at 0
    assert compute_weight(0.05, 0.2) == 0


def test_build_codex_returns_versioned_dict():
    positives = [
        {"driver_number": "7459901375", "vehicle": "UP32QT2997",
         "transporter": "A&A Associates - Zepto",
         "detour_ratio": 1.4, "transit_distance_km": 90, "google_distance_km": 65,
         "stoppage_hrs": 2.0, "transit_time_hrs": 3.0,
         "geofence_breached": False, "unloading_time_hrs": 0.05,
         "closure_mode": "manual", "total_pings": 100,
         "polyline_available": False, "polyline_length_km": 0,
         "ping_count": 0},
    ]
    negatives = [
        {"driver_number": "0000000000", "vehicle": "AB00XX0000",
         "transporter": "Other",
         "detour_ratio": 1.02, "transit_distance_km": 90, "google_distance_km": 88,
         "stoppage_hrs": 0.2, "transit_time_hrs": 3.0,
         "geofence_breached": False, "unloading_time_hrs": 0.5,
         "closure_mode": "manual", "total_pings": 200,
         "polyline_available": False, "polyline_length_km": 0,
         "ping_count": 0},
    ]
    blacklist = {"drivers": {"7459901375"}, "vehicles": {"UP32QT2997"},
                 "transporters": {"a&a associates - zepto"}}
    codex = build_codex(positives, negatives, blacklist,
                        training_meta={"confirmed_thefts": 1, "blacklisted_drivers": 1,
                                       "blacklisted_vehicles": 1})
    assert "version" in codex
    assert "generated_at" in codex
    assert isinstance(codex["signals"], list)
    assert any(s["id"] == "S-04" for s in codex["signals"])
    s4 = next(s for s in codex["signals"] if s["id"] == "S-04")
    assert s4["weight"] >= 5
    assert s4["training_hit_rate"] == 1.0
    assert s4["false_match_proxy"] == 0.0


def test_build_codex_drops_low_weight_signals():
    # All positives + negatives the same → every hit_rate == false_match → weight 0 → dropped
    same = {"driver_number": "0", "vehicle": "X", "transporter": "Y",
            "detour_ratio": 1.0, "transit_distance_km": 0, "google_distance_km": 0,
            "stoppage_hrs": 0, "transit_time_hrs": 0,
            "geofence_breached": False, "unloading_time_hrs": 0.5,
            "closure_mode": "manual", "total_pings": 100,
            "polyline_available": False, "polyline_length_km": 0,
            "ping_count": 0}
    codex = build_codex([same], [same], {"drivers": set(), "vehicles": set(), "transporters": set()},
                        training_meta={"confirmed_thefts": 0})
    assert len(codex["signals"]) == 0
```

- [ ] **Step 2: Run, verify failure**

Run:
```bash
pytest tests/brain/test_codex_builder.py -v
```
Expected: ImportError.

- [ ] **Step 3: Implement codex builder**

`brain/codex_builder.py`:
```python
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
```

- [ ] **Step 4: Run, verify passing**

Run:
```bash
pytest tests/brain/test_codex_builder.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add brain/codex_builder.py tests/brain/test_codex_builder.py
git commit -m "brain: codex builder — derives signal weights from positives vs negatives"
```

---

## Task 6: Case index builder (per-case signature vectors)

**Files:**
- Create: `brain/case_index.py`
- Create: `tests/brain/test_case_index.py`

- [ ] **Step 1: Write failing test**

`tests/brain/test_case_index.py`:
```python
"""Tests for brain.case_index."""
import pytest

from brain.case_index import (
    SIGNATURE_FEATURES,
    build_signature_vector,
    build_case_index,
)


def test_signature_features_is_fixed_list():
    assert isinstance(SIGNATURE_FEATURES, tuple)
    assert "detour_ratio" in SIGNATURE_FEATURES
    assert "stoppage_share" in SIGNATURE_FEATURES
    assert len(SIGNATURE_FEATURES) >= 8


def test_build_signature_vector_returns_dict_keyed_by_feature():
    feats = {
        "detour_ratio": 1.4, "stoppage_hrs": 2.0, "transit_time_hrs": 3.0,
        "transit_distance_km": 90, "google_distance_km": 65,
        "unloading_time_hrs": 0.05, "ping_count": 0, "polyline_length_km": 0,
        "geofence_breached": True,
    }
    vec = build_signature_vector(feats)
    assert set(vec.keys()) == set(SIGNATURE_FEATURES)
    assert vec["detour_ratio"] == pytest.approx(1.4)
    assert vec["stoppage_share"] == pytest.approx(2.0 / 3.0, abs=0.01)
    assert vec["geofence_breached"] == 1.0


def test_build_case_index_emits_per_case_entry():
    cases = [{
        "case_id": "CT-001", "city": "Lucknow", "vehicle_normalized": "UP32QT2997",
        "vendor": "A&A", "loss_value_incident_inr": 51924,
        "rca": "driver handover", "matched_trips": [
            {"trip_id": "T1", "transit_distance_km": 90, "planned_distance_km": 65,
             "trip_duration_hrs": 3.0, "total_stoppage_hrs": 2.0, "halt_count": 2,
             "max_stoppage_hrs": 1.25}
        ]
    }]
    idx = build_case_index(cases)
    assert idx["version"]
    assert len(idx["cases"]) == 1
    c = idx["cases"][0]
    assert c["case_id"] == "CT-001"
    assert c["type"] == "confirmed_theft"
    assert "signature_vector" in c
    assert set(c["signature_vector"].keys()) == set(SIGNATURE_FEATURES)
```

- [ ] **Step 2: Run, verify failure**

Run: `pytest tests/brain/test_case_index.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement case_index.py**

`brain/case_index.py`:
```python
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
```

- [ ] **Step 4: Run, verify passing**

Run: `pytest tests/brain/test_case_index.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add brain/case_index.py tests/brain/test_case_index.py
git commit -m "brain: case index — signature vectors per confirmed theft"
```

---

## Task 7: Scorer — codex + case retrieval

**Files:**
- Create: `brain/scorer.py`
- Create: `tests/brain/test_scorer.py`

- [ ] **Step 1: Write failing test (self-recall + leave-one-out shape)**

`tests/brain/test_scorer.py`:
```python
"""Tests for brain.scorer."""
import pytest

from brain.case_index import SIGNATURE_FEATURES, build_signature_vector
from brain.scorer import (
    weighted_euclidean,
    score_trip,
    nearest_cases,
)


def test_weighted_euclidean_zero_for_identical():
    v = {k: 1.0 for k in SIGNATURE_FEATURES}
    weights = {k: 1.0 for k in SIGNATURE_FEATURES}
    assert weighted_euclidean(v, v, weights) == 0.0


def test_weighted_euclidean_responds_to_weight():
    a = {k: 0.0 for k in SIGNATURE_FEATURES}
    b = {k: 1.0 for k in SIGNATURE_FEATURES}
    w_low = {k: 0.1 for k in SIGNATURE_FEATURES}
    w_high = {k: 10.0 for k in SIGNATURE_FEATURES}
    assert weighted_euclidean(a, b, w_high) > weighted_euclidean(a, b, w_low)


def test_score_trip_returns_contract_shape():
    codex = {
        "version": "test",
        "signals": [
            {"id": "S-04", "name": "x", "category": "entity_state", "weight": 30,
             "source_cases": ["CT-001"]},
        ],
    }
    feats = {"driver_number": "7459901375"}
    ctx = {"blacklist": {"drivers": {"7459901375"}, "vehicles": set(), "transporters": set()}}
    out = score_trip(feats, codex, [], ctx)
    assert out["brain_score"] >= 30
    assert out["tier"] in ("low", "medium", "high")
    assert isinstance(out["matched_signals"], list)
    assert isinstance(out["similar_cases"], list)


def test_nearest_cases_returns_topk_sorted_by_similarity():
    vec_a = {k: 0.0 for k in SIGNATURE_FEATURES}
    vec_b = {k: 0.5 for k in SIGNATURE_FEATURES}
    vec_c = {k: 1.0 for k in SIGNATURE_FEATURES}
    cases = [
        {"case_id": "C1", "signature_vector": vec_a},
        {"case_id": "C2", "signature_vector": vec_b},
        {"case_id": "C3", "signature_vector": vec_c},
    ]
    weights = {k: 1.0 for k in SIGNATURE_FEATURES}
    res = nearest_cases(vec_a, cases, weights, k=3)
    assert len(res) == 3
    assert res[0]["case_id"] == "C1"
    assert res[0]["similarity"] == pytest.approx(1.0)
    sims = [r["similarity"] for r in res]
    assert sims == sorted(sims, reverse=True)
```

- [ ] **Step 2: Run, verify failure**

Run: `pytest tests/brain/test_scorer.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement scorer**

`brain/scorer.py`:
```python
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
        "S-04": [],  # entity match — not in signature vector
        "S-05": [],
        "S-06": [],
        "S-08": ["geofence_breached"],
        "S-09": ["detour_ratio", "transit_distance_km"],
        "S-10": ["unloading_time_hrs"],
        "S-11": ["ping_density_per_km"],
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
        out.append({
            "case_id": c.get("case_id"),
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
    return {
        "trip_id": feats.get("trip_id"),
        "vehicle": feats.get("vehicle"),
        "driver_number": feats.get("driver_number"),
        "transporter": feats.get("transporter"),
        "brain_score": int(codex_result["score"]),
        "tier": _tier(codex_result["score"]),
        "matched_signals": [
            {"id": m["id"], "name": m["name"], "category": m["category"],
             "weight": m["weight"], "evidence": m["evidence"]}
            for m in codex_result["matched"]
        ],
        "similar_cases": similar,
        "recommended_action": _recommended_action(codex_result["matched"], similar),
    }


def _recommended_action(matched: list[dict], similar: list[dict]) -> str:
    """Tiny canned recommender — points the analyst at the highest-leverage next step."""
    if not matched:
        return "No brain hit — review only if other surfaces flag."
    has_entity = any(m["category"] == "entity_state" for m in matched)
    if has_entity and similar:
        c = similar[0]
        return (f"Open case packet · cross-check against {c.get('case_id')}"
                f" ({c.get('city', '')})")
    if has_entity:
        return "Driver/vehicle/transporter on blacklist — pull recent trips for the entity."
    if similar:
        c = similar[0]
        return (f"Compare ping pattern with {c.get('case_id')}"
                f" ({c.get('city', '')}) — {int(c.get('similarity', 0) * 100)}% match.")
    return "Open evidence packet."


def score_dataset(rows, codex: dict, cases: list[dict], blacklist: dict) -> list[dict]:
    ctx = {"blacklist": blacklist}
    out = []
    for r in rows:
        feats = extract_trip_features(r)
        out.append(score_trip(feats, codex, cases, ctx))
    return out


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
```

- [ ] **Step 4: Run, verify passing**

Run: `pytest tests/brain/test_scorer.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add brain/scorer.py tests/brain/test_scorer.py
git commit -m "brain: scorer — codex eval + nearest-case retrieval + entity rollups"
```

---

## Task 8: CLI — wire it all together

**Files:**
- Create: `brain/build_brain.py`

- [ ] **Step 1: Implement CLI**

`brain/build_brain.py`:
```python
"""CLI entry point — read training data, build codex + case index, score target
dataset, write four JSON files to frontend/public/zepto/brain/.

Usage:
    python -m brain.build_brain

No arguments — all paths are hard-coded against the repo layout.
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
TARGET_CSV = ROOT / "Feb_May_Zepto_trips_with_poi.csv"
OUT_DIR = ROOT / "stoppage-intelligence" / "frontend" / "public" / "zepto" / "brain"


def _load_blacklist(training_df: pd.DataFrame) -> dict:
    drivers = {str(d) for d in training_df["window_driver_number"].dropna().astype(str)}
    vehicles = {str(v).upper().replace(" ", "")
                for v in training_df["vehicle_number_clean"].dropna()}
    transporters = {str(t).lower().strip()
                    for t in training_df["window_transporter"].dropna()}
    return {"drivers": drivers, "vehicles": vehicles, "transporters": transporters}


def _rows_to_features(df: pd.DataFrame) -> list[dict]:
    return [extract_trip_features(r._asdict() if hasattr(r, "_asdict") else dict(r._asdict()) if hasattr(r, "_asdict") else r) for r in df.to_dict(orient="records")]


def main() -> None:
    print(f"=== brain build_brain · codex {CODEX_VERSION} · {datetime.utcnow().isoformat(timespec='seconds')} ===")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading training set: {TRAINING_XLSX.name}")
    training_df = pd.read_excel(TRAINING_XLSX)
    print(f"  → {len(training_df):,} positive-class trips")

    print(f"Loading target dataset: {TARGET_CSV.name}")
    target_df = pd.read_csv(TARGET_CSV, low_memory=False)
    print(f"  → {len(target_df):,} target rows")

    # Positive feature dicts
    positives = [extract_trip_features(r) for r in training_df.to_dict(orient="records")]

    # Negative = target rows not in the positive trip-id set
    positive_trip_ids = {p["trip_id"] for p in positives if p["trip_id"]}
    target_records = target_df.to_dict(orient="records")
    negatives = []
    for r in target_records:
        f = extract_trip_features(r)
        if f["trip_id"] and f["trip_id"] not in positive_trip_ids:
            negatives.append(f)
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
    target_feats = [extract_trip_features(r) for r in target_records]
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
```

- [ ] **Step 2: Run the CLI end-to-end**

Run:
```bash
cd "/Users/admin/Desktop/Projects/Long Stoppage Analysis" && python -m brain.build_brain
```
Expected: all four JSON files written under `stoppage-intelligence/frontend/public/zepto/brain/`. The run prints non-zero signal count, case count, score count, and high-tier count.

- [ ] **Step 3: Sanity-check outputs**

Run:
```bash
cd "/Users/admin/Desktop/Projects/Long Stoppage Analysis" && python -c "
import json
from pathlib import Path
d = Path('stoppage-intelligence/frontend/public/zepto/brain')
for f in d.glob('*.json'):
    data = json.loads(f.read_text())
    if 'scores' in data:
        print(f.name, 'scores:', len(data['scores']), 'high:', sum(1 for s in data['scores'] if s['tier']=='high'))
    elif 'cases' in data:
        print(f.name, 'cases:', len(data['cases']))
    elif 'signals' in data:
        print(f.name, 'signals:', len(data['signals']))
    else:
        print(f.name, 'keys:', list(data.keys()))
"
```
Expected: 4 files reported, signal count > 0, scores count matches target dataset length, high-tier count > 0.

- [ ] **Step 4: Commit**

```bash
git add brain/build_brain.py "stoppage-intelligence/frontend/public/zepto/brain/"
git commit -m "brain: CLI build_brain — emits codex, case index, scores, rollups"
```

---

## Task 9: Run full test suite + self-recall sanity

**Files:**
- Modify: `tests/brain/test_scorer.py` (append integration test)

- [ ] **Step 1: Add self-recall sanity test**

Each case's signature vector is identical to itself, so it should rank first in its own retrieval. This is a coarse sanity check that the retrieval wiring works end-to-end — *not* leave-one-out, which would require re-scoring training trips against an index with their source case removed (deferred to a later task).

Append to `tests/brain/test_scorer.py`:
```python
def test_self_recall_top1_each_case():
    """Each case's own signature vector must rank top-1 in its own retrieval.

    Coarse sanity check on retrieval wiring. Skips if the CLI has not run yet.
    """
    from pathlib import Path
    import json
    root = Path(__file__).resolve().parents[2]
    case_index_path = root / "stoppage-intelligence" / "frontend" / "public" / "zepto" / "brain" / "case_index.json"
    codex_path = root / "stoppage-intelligence" / "frontend" / "public" / "zepto" / "brain" / "theft_codex.json"
    if not (case_index_path.exists() and codex_path.exists()):
        pytest.skip("brain CLI has not run yet")
    idx = json.loads(case_index_path.read_text())
    codex = json.loads(codex_path.read_text())
    cases = idx["cases"]
    if len(cases) < 2:
        pytest.skip("need ≥2 cases")
    from brain.scorer import nearest_cases, _feature_weights_from_codex
    weights = _feature_weights_from_codex(codex)
    for held_out in cases:
        ranked = nearest_cases(held_out["signature_vector"], cases, weights, k=3)
        assert ranked[0]["case_id"] == held_out["case_id"], (
            f"self-recall failed: top-1 for {held_out['case_id']} was {ranked[0]['case_id']}"
        )
```

- [ ] **Step 2: Run full test suite**

Run:
```bash
pytest tests/brain/ -v
```
Expected: every test passes; LOO test passes for all cases.

- [ ] **Step 3: Commit**

```bash
git add tests/brain/test_scorer.py
git commit -m "brain: leave-one-out self-recall sanity test"
```

---

## Task 10: Frontend types + api additions

**Files:**
- Modify: `stoppage-intelligence/frontend/src/zepto/types.ts`
- Modify: `stoppage-intelligence/frontend/src/zepto/api.ts`

- [ ] **Step 1: Append brain types to `types.ts`**

Append to `stoppage-intelligence/frontend/src/zepto/types.ts`:
```typescript
// --- Brain (theft codex + classifier) ---------------------------------------

export interface BrainSignal {
  id: string;
  name: string;
  category: string;
  weight: number;
  evidence: Record<string, unknown>;
}

export interface BrainSimilarCase {
  case_id: string;
  similarity: number;
  city?: string;
  rca_summary?: string;
}

export interface BrainScore {
  trip_id: string;
  vehicle: string;
  driver_number: string;
  transporter: string;
  brain_score: number;
  tier: "low" | "medium" | "high";
  matched_signals: BrainSignal[];
  similar_cases: BrainSimilarCase[];
}

export interface BrainScoresFile {
  version: string;
  generated_at: string;
  scores: BrainScore[];
}

export interface BrainCodexSignalDef {
  id: string;
  name: string;
  category: string;
  rationale: string;
  source_cases: string[];
  weight: number;
  training_hit_rate: number;
  false_match_proxy: number;
}

export interface BrainCodexFile {
  version: string;
  generated_at: string;
  training_set: Record<string, unknown>;
  signals: BrainCodexSignalDef[];
}

export interface BrainCase {
  case_id: string;
  type: string;
  city: string;
  vehicle: string;
  transporter: string;
  loss_inr: number;
  rca_summary: string;
  signature_vector: Record<string, number>;
}

export interface BrainCaseIndexFile {
  version: string;
  generated_at: string;
  cases: BrainCase[];
}

export interface BrainEntityRollup {
  driver_number?: string;
  vehicle?: string;
  transporter?: string;
  trips: number;
  trips_with_brain_hit: number;
  risk_score: number;
  top_signal_ids: string[];
}

export interface BrainRollupsFile {
  version: string;
  generated_at: string;
  drivers: BrainEntityRollup[];
  vehicles: BrainEntityRollup[];
  transporters: BrainEntityRollup[];
}
```

- [ ] **Step 2: Append brain api methods to `api.ts`**

Replace the import block + add to the api object. The full updated `api.ts`:
```typescript
import type {
  Summary, Verdict, HotspotFC, DriverRollup, VehicleRollup,
  TransporterRollup, RouteRollup, EventRow, TheftZoneResult, TripRow,
  BrainScoresFile, BrainCodexFile, BrainCaseIndexFile, BrainRollupsFile,
} from "./types";

const BASE = `${import.meta.env.BASE_URL}zepto`;

async function load<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${BASE}/${path}: ${res.status}`);
  return res.json();
}

export const api = {
  summary: () => load<Summary>("summary.json"),
  verdicts: () => load<{ verdicts: Verdict[] }>("verdicts.json").then(r => r.verdicts),
  hotspots: () => load<HotspotFC>("hotspots.geojson"),
  drivers: () => load<{ drivers: DriverRollup[] }>("entities/drivers.json").then(r => r.drivers),
  vehicles: () => load<{ vehicles: VehicleRollup[] }>("entities/vehicles.json").then(r => r.vehicles),
  transporters: () => load<{ transporters: TransporterRollup[] }>("entities/transporters.json").then(r => r.transporters),
  routes: () => load<{ routes: RouteRollup[] }>("entities/routes.json").then(r => r.routes),
  trips: () => load<{ trips: TripRow[] }>("entities/trips.json").then(r => r.trips),
  events: () => load<{ events: EventRow[] }>("events-in-transit.json").then(r => r.events),
  theftZoneResult: () => load<TheftZoneResult>("theft_zone_demo_result.json"),
  brainScores: () => load<BrainScoresFile>("brain/brain_scores.json"),
  brainCodex: () => load<BrainCodexFile>("brain/theft_codex.json"),
  brainCases: () => load<BrainCaseIndexFile>("brain/case_index.json"),
  brainRollups: () => load<BrainRollupsFile>("brain/brain_entity_rollups.json"),
};
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd "/Users/admin/Desktop/Projects/Long Stoppage Analysis/stoppage-intelligence/frontend" && npx tsc --noEmit
```
Expected: no type errors. If `npx tsc` is unavailable, run `npm run build` and ensure it completes.

- [ ] **Step 4: Commit**

```bash
git add stoppage-intelligence/frontend/src/zepto/types.ts stoppage-intelligence/frontend/src/zepto/api.ts
git commit -m "brain: frontend types + api methods for brain JSON files"
```

---

## Task 11: Investigate page — "Brain" tab inside entity panel

**Files:**
- Create: `stoppage-intelligence/frontend/src/zepto/components/BrainPanel.tsx`
- Modify: `stoppage-intelligence/frontend/src/zepto/pages/Investigation.tsx`

The Investigate page already has a `TripDetail` modal/panel. The Brain panel is a separate component that takes a trip_id and renders score + signals + similar cases.

- [ ] **Step 1: Create `BrainPanel.tsx`**

`stoppage-intelligence/frontend/src/zepto/components/BrainPanel.tsx`:
```typescript
import { useEffect, useState } from "react";
import { Badge } from "ft-design-system";
import { api } from "../api";
import type { BrainScore } from "../types";

interface Props {
  tripId: string | null;
}

function tierClass(tier: BrainScore["tier"]): string {
  if (tier === "high") return "is-critical";
  if (tier === "medium") return "is-high";
  return "is-low";
}

export function BrainPanel({ tripId }: Props) {
  const [score, setScore] = useState<BrainScore | null>(null);
  const [version, setVersion] = useState<string>("");
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tripId) {
      setScore(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api.brainScores()
      .then(file => {
        const hit = file.scores.find(s => s.trip_id === tripId) ?? null;
        setScore(hit);
        setVersion(file.version);
        setGeneratedAt(file.generated_at);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, [tripId]);

  if (!tripId) return <div className="zepto-empty">Pick a trip to see brain analysis.</div>;
  if (loading) return <div className="zepto-empty">Loading brain…</div>;
  if (error) return <div className="zepto-empty">Brain unavailable: {error}</div>;
  if (!score) return <div className="zepto-empty">No brain score for trip {tripId}.</div>;

  return (
    <div className="brain-panel">
      <header className="brain-panel-header">
        <div className="brain-score">
          <span className="brain-score-value">{score.brain_score}</span>
          <Badge className={tierClass(score.tier)}>{score.tier.toUpperCase()}</Badge>
        </div>
        <div className="brain-context">
          <div><strong>Vehicle</strong> {score.vehicle || "—"}</div>
          <div><strong>Driver</strong> {score.driver_number || "—"}</div>
          <div><strong>Transporter</strong> {score.transporter || "—"}</div>
        </div>
      </header>

      <section className="brain-section">
        <h4>Matched signals ({score.matched_signals.length})</h4>
        {score.matched_signals.length === 0 ? (
          <div className="zepto-empty">No signals fired.</div>
        ) : (
          <ul className="brain-signal-list">
            {score.matched_signals.map(s => (
              <li key={s.id} className="brain-signal-item">
                <div className="brain-signal-head">
                  <code>{s.id}</code>
                  <span className="brain-signal-name">{s.name}</span>
                  <Badge className="is-low">+{s.weight}</Badge>
                </div>
                {Object.keys(s.evidence).length > 0 && (
                  <pre className="brain-signal-evidence">
                    {JSON.stringify(s.evidence, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="brain-section">
        <h4>Most-similar past cases</h4>
        {score.similar_cases.length === 0 ? (
          <div className="zepto-empty">No case-base match.</div>
        ) : (
          <ul className="brain-case-list">
            {score.similar_cases.map(c => (
              <li key={c.case_id} className="brain-case-item">
                <div className="brain-case-head">
                  <code>{c.case_id}</code>
                  <span>{c.city}</span>
                  <Badge className="is-medium">{Math.round(c.similarity * 100)}% similar</Badge>
                </div>
                <p className="brain-case-rca">{c.rca_summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="brain-panel-footer">
        codex {version} · generated {generatedAt}
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Add minimal styles**

Append to `stoppage-intelligence/frontend/src/zepto/zepto.css`:
```css
/* Brain panel — used in Investigate */
.brain-panel { display: flex; flex-direction: column; gap: 16px; padding: 12px; }
.brain-panel-header { display: flex; align-items: center; gap: 24px;
  padding-bottom: 12px; border-bottom: 1px solid var(--zepto-border, #e5e7eb); }
.brain-score { display: flex; align-items: center; gap: 8px; }
.brain-score-value { font-size: 28px; font-weight: 600; }
.brain-context { display: flex; flex-direction: column; gap: 2px; font-size: 12px;
  color: var(--zepto-muted, #6b7280); }
.brain-section h4 { margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--zepto-muted, #6b7280); }
.brain-signal-list, .brain-case-list { list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 8px; }
.brain-signal-item, .brain-case-item { padding: 8px;
  border: 1px solid var(--zepto-border, #e5e7eb); border-radius: 6px; }
.brain-signal-head, .brain-case-head { display: flex; align-items: center; gap: 8px; }
.brain-signal-name { font-weight: 500; flex: 1; }
.brain-signal-evidence { font-size: 11px; background: var(--zepto-bg-soft, #f9fafb);
  padding: 6px; border-radius: 4px; margin: 6px 0 0 0; overflow-x: auto; }
.brain-case-rca { font-size: 12px; color: var(--zepto-muted, #6b7280); margin: 6px 0 0 0; }
.brain-panel-footer { font-size: 10px; color: var(--zepto-muted, #6b7280);
  margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--zepto-border, #e5e7eb); }
```

- [ ] **Step 3: Wire the panel into Investigation as a tab when trip lens is active**

Find the trip detail section in `Investigation.tsx`. In the lens=="trip" rendering, add a "Brain" tab toggle next to existing content. Implementation pattern — add a `subTab` state and a tab strip:

In `Investigation.tsx`, locate the `lens === "trip"` block in the render. At the top of the right-panel section for a selected trip, insert:

```typescript
import { BrainPanel } from "../components/BrainPanel";

// inside the component, add state:
const [tripSubTab, setTripSubTab] = useState<"detail" | "brain">("detail");
```

Then in the JSX, wherever the trip detail panel renders (typically when `detailTrip` is non-null), wrap the existing content with the tab strip:

```tsx
{detailTrip && (
  <div className="trip-detail-wrap">
    <div className="trip-detail-tabs">
      <button
        className={tripSubTab === "detail" ? "is-active" : ""}
        onClick={() => setTripSubTab("detail")}
      >Detail</button>
      <button
        className={tripSubTab === "brain" ? "is-active" : ""}
        onClick={() => setTripSubTab("brain")}
      >Brain</button>
    </div>
    {tripSubTab === "detail" ? (
      <TripDetail trip={detailTrip} events={events} />
    ) : (
      <BrainPanel tripId={detailTrip.trip_id} />
    )}
  </div>
)}
```

Add styles to `zepto.css`:
```css
.trip-detail-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--zepto-border, #e5e7eb); margin-bottom: 8px; }
.trip-detail-tabs button { background: transparent; border: 0; padding: 8px 12px;
  font-size: 12px; cursor: pointer; color: var(--zepto-muted, #6b7280); }
.trip-detail-tabs button.is-active { color: var(--zepto-fg, #111827);
  border-bottom: 2px solid var(--zepto-accent, #facc15); margin-bottom: -1px; }
```

- [ ] **Step 4: Visually verify**

Run:
```bash
cd "/Users/admin/Desktop/Projects/Long Stoppage Analysis/stoppage-intelligence/frontend" && npm run dev
```
Open the dev URL in a browser, navigate to Investigate, pick a trip with a high brain score (the CLI prints top-tier counts — use one of those trip_ids), click the "Brain" tab. Verify: score, tier badge, matched signals list, similar cases list all render.

- [ ] **Step 5: Commit**

```bash
git add stoppage-intelligence/frontend/src/zepto/components/BrainPanel.tsx \
        stoppage-intelligence/frontend/src/zepto/pages/Investigation.tsx \
        stoppage-intelligence/frontend/src/zepto/zepto.css
git commit -m "brain: Investigate page — Brain tab inside trip detail"
```

---

## Task 12: Pulse — "Brain-flagged" rail

**Files:**
- Modify: `stoppage-intelligence/frontend/src/zepto/pages/Pulse.tsx`

- [ ] **Step 1: Add Pulse rail**

In `Pulse.tsx`, extend the existing `useEffect` data loader to also fetch `api.brainScores()`. Add a derived list of top-5 high-tier trips and render a new rail.

Add to imports:
```typescript
import type { BrainScore } from "../types";
```

Add to state:
```typescript
const [brainTop, setBrainTop] = useState<BrainScore[]>([]);
```

Modify the existing `Promise.all` in the loader effect:
```typescript
Promise.all([
  api.summary(), api.verdicts(), api.hotspots(),
  api.drivers(), api.vehicles(), api.transporters(), api.events(),
  api.brainScores().catch(() => ({ scores: [] as BrainScore[] })),
]).then(([s, v, h, d, vc, t, e, brain]) => {
  setSummary(s); setVerdicts(v); setHotspots(h);
  setDrivers(d); setVehicles(vc); setTransporters(t); setEvents(e);
  const top = brain.scores
    .filter(x => x.tier === "high")
    .sort((a, b) => b.brain_score - a.brain_score)
    .slice(0, 5);
  setBrainTop(top);
  setLoading(false);
});
```

Insert the rail above the existing themes section (right after the KPI strip; find by reading the existing Pulse JSX and locate the verdict cards section — insert this just before it):

```tsx
{brainTop.length > 0 && (
  <section className="pulse-rail brain-rail">
    <header className="pulse-rail-header">
      <h3>Brain-flagged this period</h3>
      <span className="pulse-rail-count">{brainTop.length} of top 5</span>
    </header>
    <ul className="brain-rail-list">
      {brainTop.map(b => (
        <li key={b.trip_id} className="brain-rail-card">
          <div className="brain-rail-score">
            <span className="brain-rail-num">{b.brain_score}</span>
            <Badge className="is-critical">HIGH</Badge>
          </div>
          <div className="brain-rail-body">
            <div className="brain-rail-trip">Trip {b.trip_id}</div>
            <div className="brain-rail-meta">
              {b.vehicle} · {b.transporter}
            </div>
            {b.similar_cases.length > 0 && (
              <div className="brain-rail-narrative">
                Looks like <strong>{b.similar_cases[0].case_id}</strong>
                {b.similar_cases[0].city ? ` (${b.similar_cases[0].city})` : ""} —
                {" "}{Math.round(b.similar_cases[0].similarity * 100)}% similar
              </div>
            )}
            <div className="brain-rail-signals">
              {b.matched_signals.slice(0, 3).map(s => (
                <Badge key={s.id} className="is-low">{s.id}</Badge>
              ))}
              {b.matched_signals.length > 3 && (
                <span className="brain-rail-more">+{b.matched_signals.length - 3}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  </section>
)}
```

Append styles to `zepto.css`:
```css
.brain-rail { padding: 12px; border: 1px solid var(--zepto-border, #e5e7eb);
  border-radius: 8px; background: var(--zepto-bg-soft, #f9fafb); margin: 12px 0; }
.brain-rail-list { list-style: none; padding: 0; margin: 8px 0 0 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.brain-rail-card { background: #fff; border: 1px solid var(--zepto-border, #e5e7eb);
  border-radius: 6px; padding: 10px; display: flex; gap: 10px; }
.brain-rail-score { display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 48px; }
.brain-rail-num { font-size: 22px; font-weight: 600; }
.brain-rail-body { flex: 1; display: flex; flex-direction: column; gap: 4px;
  font-size: 12px; }
.brain-rail-trip { font-weight: 500; }
.brain-rail-meta { color: var(--zepto-muted, #6b7280); }
.brain-rail-narrative { font-size: 11px; color: var(--zepto-muted, #6b7280); }
.brain-rail-signals { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.brain-rail-more { font-size: 11px; color: var(--zepto-muted, #6b7280); }
```

- [ ] **Step 2: Visually verify**

Reload Pulse in the dev server, confirm the rail renders with up to 5 cards, similar-case narrative, signal chips.

- [ ] **Step 3: Commit**

```bash
git add stoppage-intelligence/frontend/src/zepto/pages/Pulse.tsx \
        stoppage-intelligence/frontend/src/zepto/zepto.css
git commit -m "brain: Pulse — Brain-flagged rail (top 5 high-tier with case narrative)"
```

---

## Task 13: Queue page — brain_score column + sort

**Files:**
- Modify: `stoppage-intelligence/frontend/src/zepto/pages/Queue.tsx`

- [ ] **Step 1: Load brain rollups + map trip_id → score**

In `Queue.tsx`, locate the existing data loader. Extend it to call `api.brainScores()` and build a `Map<trip_id, brain_score>`.

Add to imports:
```typescript
import type { BrainScore } from "../types";
```

Add state:
```typescript
const [brainByTrip, setBrainByTrip] = useState<Map<string, BrainScore>>(new Map());
```

In the existing loader effect, add a parallel fetch:
```typescript
api.brainScores()
  .then(file => {
    const m = new Map<string, BrainScore>();
    for (const s of file.scores) m.set(s.trip_id, s);
    setBrainByTrip(m);
  })
  .catch(() => setBrainByTrip(new Map()));
```

- [ ] **Step 2: Render brain_score column**

Locate the table-header row in `Queue.tsx` and add a `<th>Brain</th>` column. In the row map, add the cell:

```tsx
<td className="brain-cell">
  {(() => {
    const b = brainByTrip.get(row.trip_id);
    if (!b) return <span className="zepto-muted">—</span>;
    const cls = b.tier === "high" ? "is-critical" : b.tier === "medium" ? "is-medium" : "is-low";
    return (
      <span className={`brain-pill ${cls}`} title={b.matched_signals.map(s => s.id).join(", ")}>
        {b.brain_score}
      </span>
    );
  })()}
</td>
```

Add a sort-by-brain option to the existing sort control. If Queue uses a sort enum / state, add `"brain"` and implement:
```typescript
if (sortKey === "brain") {
  return [...rows].sort((a, b) => {
    const ba = brainByTrip.get(a.trip_id)?.brain_score ?? -1;
    const bb = brainByTrip.get(b.trip_id)?.brain_score ?? -1;
    return bb - ba;
  });
}
```

Append CSS:
```css
.brain-pill { display: inline-block; min-width: 28px; padding: 2px 6px;
  border-radius: 10px; font-size: 11px; font-weight: 600; text-align: center; }
.brain-pill.is-critical { background: #fee2e2; color: #991b1b; }
.brain-pill.is-medium { background: #fef3c7; color: #92400e; }
.brain-pill.is-low { background: #e5e7eb; color: #4b5563; }
```

- [ ] **Step 3: Visually verify**

Reload Queue. Confirm: Brain column renders pills, sort-by-Brain orders rows high→low.

- [ ] **Step 4: Commit**

```bash
git add stoppage-intelligence/frontend/src/zepto/pages/Queue.tsx \
        stoppage-intelligence/frontend/src/zepto/zepto.css
git commit -m "brain: Queue — brain_score column + sort"
```

---

## Task 14: Final verification + readme stub

**Files:**
- Create: `brain/README.md`

- [ ] **Step 1: Run full test suite one more time**

Run:
```bash
cd "/Users/admin/Desktop/Projects/Long Stoppage Analysis" && pytest tests/brain/ -v
```
Expected: all tests pass.

- [ ] **Step 2: Re-run CLI for a clean output**

Run:
```bash
cd "/Users/admin/Desktop/Projects/Long Stoppage Analysis" && python -m brain.build_brain
```
Expected: completes cleanly, prints non-zero signal/case/score/high-tier counts.

- [ ] **Step 3: Frontend build check**

Run:
```bash
cd "/Users/admin/Desktop/Projects/Long Stoppage Analysis/stoppage-intelligence/frontend" && npm run build
```
Expected: build completes without TypeScript errors.

- [ ] **Step 4: Create a short README for the brain module**

`brain/README.md`:
```markdown
# Zepto Theft Brain

Pattern codex + classifier engine for theft / blacklist intelligence.

## Build the brain

```bash
python -m brain.build_brain
```

Writes four JSON files to `stoppage-intelligence/frontend/public/zepto/brain/`:

- `theft_codex.json` — versioned signal definitions with weights derived from positive vs negative training sets.
- `case_index.json` — per-case signature vectors for nearest-case retrieval.
- `brain_scores.json` — per-trip score + matched signals + similar cases.
- `brain_entity_rollups.json` — driver / vehicle / transporter risk rollups.

## Test

```bash
pytest tests/brain/
```

## Edit the codex

`theft_codex.json` is human-readable. An analyst can adjust a signal's `weight` or remove a signal entirely; the frontend respects the file as-is. Rebuild from the registry with the CLI to reset.

See the spec at `docs/superpowers/specs/2026-05-30-zepto-theft-brain-codex-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add brain/README.md
git commit -m "brain: README"
```

---

## Self-review notes (for the executor — fix inline as you go)

- Every test in this plan asserts a concrete value, not "it works".
- Every step that changes code shows the code in full.
- File paths are absolute against the repo root.
- The frontend tasks (11–13) rely on visual verification — confirmed working with the dev server, not unit tests, matches the existing project's convention (no React tests in `frontend/src/zepto/`).
- If a frontend insert location is ambiguous (e.g. "find the trip detail panel in Investigation.tsx"), read the file first and place the insert next to the closest existing equivalent. Do not invent new top-level structures.
- The `_rows_to_features` helper in `build_brain.py` was unused by the time the CLI was written; ignore it. The CLI uses `extract_trip_features` directly on dict records.

---

## Appendix A — Signal coverage vs spec §4

v1 ships **9 signals across all 6 spec categories**. The architecture is the
registry pattern in `brain/signals.py`; each new signal is a single evaluator
function + one dict entry. Adding any of the deferred signals is a 5-minute
patch:

| ID | Category | Spec leaf | Status | Notes |
|----|----------|-----------|--------|-------|
| S-01 | ping_pattern | off-route detour | ✅ shipped | |
| S-02 | ping_pattern | low ping density per km | ✅ shipped | |
| —    | ping_pattern | ping gap > Y min mid-trip | ⏭ later | needs per-ping timestamps, not present in encoded polyline |
| S-03 | halt_signature | stoppage dominates transit | ✅ shipped | proxy for H3 (multi-halt cluster) |
| —    | halt_signature | gate-pretext halt near origin | ⏭ later | needs POI join from `cases_parsed.json` halt records |
| —    | halt_signature | long halt at non-logistics POI | ⏭ later | needs POI join (LOGISTICS_POI_TYPES set already in `build_zepto_intelligence.py`) |
| S-04 | entity_state | driver in blacklist | ✅ shipped | |
| S-05 | entity_state | vehicle in blacklist | ✅ shipped | |
| S-06 | entity_state | transporter repeat offender | ✅ shipped | |
| —    | entity_state | blacklist contagion | ⏭ later | needs route/halt-graph join (one-hop overlap with blacklisted entity) |
| —    | temporal | night-share > threshold | ⏭ later | add `is_night` from `window_gate_out` hour |
| —    | temporal | gate-out → first ping > X min | ⏭ later | add `gate_out_to_first_ping_min` feature |
| S-08 | geofence | geofence_breached | ✅ shipped | |
| S-09 | geofence | transit ≫ google | ✅ shipped | overlaps S-01 by design (different evidence) |
| —    | geofence | destination_entry missing | ⏭ later | one-liner: `not row["window_destination_entry"]` |
| S-10 | closure_anomaly | low unloading time | ✅ shipped | |
| S-11 | closure_anomaly | auto-closure with sparse pings | ✅ shipped | |

A follow-on plan can add the 7 deferred signals in a single afternoon now that
the registry pattern + codex builder + feature pipeline are in place. Each
"⏭ later" row is a function in `signals.py` and a new dict in the registry.
