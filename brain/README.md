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
