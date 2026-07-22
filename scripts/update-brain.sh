#!/bin/bash
# ============================================================
# update-brain.sh — Update Pythagoras Brain after a task
# ============================================================
# Usage:
#   bash scripts/update-brain.sh "Task title" "What was done" "Lessons learned"
#
# This script appends a new entry to the Tasks.md and
# reminds the AI to update other relevant files.
# ============================================================

set -e

cd "$(dirname "$0")/.."  # project root

BRAIN_DIR="Pythagoras-Brain"
TASKS_FILE="$BRAIN_DIR/Development-History/Tasks.md"

# Check arguments
if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/update-brain.sh \"Task title\" [\"What was done\"] [\"Lessons\"]"
  echo ""
  echo "Example:"
  echo "  bash scripts/update-brain.sh \"Add auth system\" \"Implemented JWT login\" \"Don't store tokens in localStorage\""
  exit 1
fi

TASK_TITLE="$1"
WHAT_DONE="${2:-}"
LESSONS="${3:-}"
DATE=$(date '+%Y-%m-%d')

# Create entry
ENTRY="

---

## $TASK_TITLE

**التاريخ:** $DATE
"

if [ -n "$WHAT_DONE" ]; then
  ENTRY="$ENTRY
**ما تم:** $WHAT_DONE"
fi

if [ -n "$LESSONS" ]; then
  ENTRY="$ENTRY
**الدرس:** $LESSONS"
fi

# Append to Tasks.md (before the "## المهام الجارية" section)
# Find the line and insert before it
python3 << PYEOF
with open("$TASKS_FILE", "r") as f:
    content = f.read()

entry = """$ENTRY"""

# Insert before "## المهام الجارية"
marker = "## المهام الجارية"
if marker in content:
    content = content.replace(marker, entry + "\n" + marker)
else:
    # Append at end
    content = content + "\n" + entry

with open("$TASKS_FILE", "w") as f:
    f.write(content)

print("✓ Updated $TASKS_FILE")
PYEOF

echo ""
echo "=== Brain updated! ==="
echo ""
echo "Don't forget to also update:"
echo "  - Problems-and-Solutions/Problem-Log.md (if there was a problem)"
echo "  - Decisions/*.md (if a decision was made)"
echo "  - AI-Memory/Lessons-Learned.md (if a lesson was learned)"
echo "  - AI-Memory/Mistakes-To-Avoid.md (if a mistake was made)"
echo ""
echo "Then: git add Pythagoras-Brain/ && git commit -m 'brain: $TASK_TITLE' && git push"
