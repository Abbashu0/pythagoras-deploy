#!/bin/bash
# safe-commit.sh — احفظ كل التغييرات فوراً في git
set -e
cd /home/z/my-project
MSG="${1:-auto-save $(date '+%Y-%m-%d %H:%M:%S')}"
if git diff --quiet HEAD 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "✓ لا توجد تغييرات غير محفوظة"
  exit 0
fi
git add -A
git commit -m "$MSG" --allow-empty-message 2>&1 | tail -3
echo ""
echo "=== آخر 3 التزامات ==="
git log --oneline -3
echo ""
echo "✓ تم الحفظ بنجاح."
