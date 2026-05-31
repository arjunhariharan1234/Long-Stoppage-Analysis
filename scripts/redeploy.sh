#!/usr/bin/env bash
# Redeploy the Zepto Theft Brain end-to-end.
#
# What it does:
#   1. Rebuild the brain (regenerate the 4 JSON files from the current codex).
#   2. If brain JSONs (or any brain/ code) changed, stage + commit + push.
#   3. Drop any stale `.vercel/output`, run a fresh `vercel build --prod`.
#   4. Deploy the prebuilt output to production.
#
# Idempotent: if nothing changed, the script just rebuilds and redeploys
# (no empty commits, no errors).
#
# Usage:
#   ./scripts/redeploy.sh                    # full rebuild + redeploy
#   ./scripts/redeploy.sh --skip-rebuild     # use existing JSONs as-is
#   ./scripts/redeploy.sh --skip-push        # don't push to origin
#   ./scripts/redeploy.sh --skip-vercel      # commit/push only, no deploy

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_REBUILD=0
SKIP_PUSH=0
SKIP_VERCEL=0
for arg in "$@"; do
  case "$arg" in
    --skip-rebuild) SKIP_REBUILD=1 ;;
    --skip-push)    SKIP_PUSH=1 ;;
    --skip-vercel)  SKIP_VERCEL=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) echo "[redeploy] unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "=========================================="
echo "  Zepto Theft Brain — redeploy"
echo "  $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================="

# --- 1. Rebuild the brain ----------------------------------------------------
if [[ "$SKIP_REBUILD" -eq 0 ]]; then
  echo "[1/4] Rebuilding brain JSONs…"
  python3 -m brain.build_brain
else
  echo "[1/4] Skipped brain rebuild (--skip-rebuild)."
fi

# --- 2. Commit + push if brain artifacts changed ------------------------------
echo "[2/4] Checking for changes to commit…"
BRAIN_DIR="stoppage-intelligence/frontend/public/zepto/brain"
BRAIN_CODE_DIRS=(brain tests/brain scripts)

# Stage brain output JSONs + any code changes in brain/, tests/brain/, scripts/
git add "$BRAIN_DIR" "${BRAIN_CODE_DIRS[@]}" 2>/dev/null || true

if git diff --cached --quiet; then
  echo "      No brain changes staged — nothing to commit."
else
  echo "      Brain artifacts changed; committing…"
  git status --short | sed 's/^/      /'
  git commit -m "$(cat <<EOF
brain: redeploy — rebuild JSONs and roll to production

Automated commit from scripts/redeploy.sh.
Generated at $(date -u +"%Y-%m-%dT%H:%M:%SZ").
EOF
)"
  if [[ "$SKIP_PUSH" -eq 0 ]]; then
    echo "      Pushing to origin/main…"
    git push origin main
  else
    echo "      Skipped git push (--skip-push)."
  fi
fi

# --- 3 & 4. Vercel build + deploy --------------------------------------------
if [[ "$SKIP_VERCEL" -eq 1 ]]; then
  echo "[3/4] Skipped Vercel build (--skip-vercel)."
  echo "[4/4] Skipped Vercel deploy (--skip-vercel)."
  echo "Done."
  exit 0
fi

echo "[3/4] Fresh Vercel build…"
rm -rf .vercel/output
vercel build --prod

echo "[4/4] Deploying to production…"
vercel deploy --prod --prebuilt --yes

echo ""
echo "Production URL:  https://frontend-two-smoky-51.vercel.app/v10/stoppage-intelligence/"
echo "Done."
