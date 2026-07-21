#!/bin/bash
# ============================================================
# update-understand.sh — Rebuild the Understand Anything knowledge graph
# ============================================================
# Usage:
#   bash scripts/update-understand.sh
# ============================================================

set -e

cd "$(dirname "$0")/.."  # project root

echo "=== Understand Anything graph rebuild ==="
echo "Project: $(pwd)"
echo ""

node scripts/understand/build-graph.mjs

echo ""
echo "=== Done ==="
ls -la .ua/knowledge-graph.json 2>/dev/null
echo ""
echo "View at: http://localhost:3000/admin/graphify (toggle to 'Understand Anything')"
