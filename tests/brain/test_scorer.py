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
