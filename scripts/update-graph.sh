#!/bin/bash
# ============================================================
# update-graph.sh — Rebuild the Graphify knowledge graph
# ============================================================
# Usage:
#   bash scripts/update-graph.sh           # full rebuild (code only)
#   bash scripts/update-graph.sh --update  # only changed files
#   bash scripts/update-graph.sh --report  # rebuild + cluster labels (needs LLM)
#
# Hook will also auto-run on every git commit.
# ============================================================

set -e

export PATH="/home/z/.local/bin:$PATH"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/home/z/.cache/uv}"

cd "$(dirname "$0")/.."  # project root

MODE="${1:---full}"

echo "=== Graphify update ($MODE) ==="
echo "Project: $(pwd)"
echo ""

if [ "$MODE" = "--update" ]; then
  echo "→ Incremental update (only changed files)..."
  graphify . --code-only --update 2>&1 | tail -20
elif [ "$MODE" = "--report" ]; then
  echo "→ Full rebuild + clustering + labels..."
  if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ] && [ -z "$GEMINI_API_KEY" ]; then
    echo "⚠ No LLM API key set — labels will stay as 'Community N' placeholders."
  fi
  graphify . --code-only 2>&1 | tail -10
  echo "→ Clustering..."
  graphify cluster-only . 2>&1 | tail -10
else
  echo "→ Full rebuild (code only, no LLM)..."
  graphify . --code-only 2>&1 | tail -20
fi

echo ""
echo "=== Done ==="
echo "Output: graphify-out/"
ls -la graphify-out/ 2>/dev/null | head -10
echo ""
echo "View at: http://localhost:3000/admin/graphify"
