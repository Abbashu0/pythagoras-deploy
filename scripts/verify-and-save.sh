#!/bin/bash
# verify-and-save.sh — تحقق من حالة git واحفظ أي تغييرات معلقة
#
# هذا السكريبت مصمم ليُستدعى:
#   1. عند بدء جلسة جديدة (للتحقق من أن كل شيء سليم)
#   2. قبل إغلاق الحاسوب (لحفظ أي عمل معلّق)
#   3. يدوياً في أي وقت للتحقق
#
# الاستخدام:
#   bash /home/z/my-project/scripts/verify-and-save.sh

cd /home/z/my-project || exit 1

echo "═══════════════════════════════════════════════"
echo "  فحص حالة المشروع — $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════════"
echo ""

# 1. حالة git
echo "📊 حالة git:"
BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
TOTAL_COMMITS=$(git rev-list --count HEAD 2>/dev/null || echo "؟")
echo "   الفرع: $BRANCH"
echo "   إجمالي الالتزامات: $TOTAL_COMMITS"
echo ""

# 2. تغييرات غير محفوظة
UNSTAGED=$(git diff --stat 2>/dev/null | tail -1)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l)
STAGED=$(git diff --cached --stat 2>/dev/null | tail -1)

HAS_CHANGES=0
if [ -n "$UNSTAGED" ] && [ "$UNSTAGED" != "" ]; then
  echo "⚠️  تغييرات غير مُرحّلة (unstaged):"
  echo "   $UNSTAGED"
  HAS_CHANGES=1
fi

if [ "$UNTRACKED" -gt 0 ]; then
  echo "⚠️  ملفات جديدة غير متتبّعة ($UNTRACKED ملف):"
  git ls-files --others --exclude-standard 2>/dev/null | head -5 | sed 's/^/   /'
  if [ "$UNTRACKED" -gt 5 ]; then
    echo "   ... و $((UNTRACKED - 5)) ملف آخر"
  fi
  HAS_CHANGES=1
fi

if [ -n "$STAGED" ] && [ "$STAGED" != "" ]; then
  echo "ℹ️  تغييرات مُرحّلة (staged):"
  echo "   $STAGED"
  HAS_CHANGES=1
fi

if [ "$HAS_CHANGES" -eq 0 ]; then
  echo "✓ كل التغييرات محفوظة — لا يوجد عمل معلّق"
else
  echo ""
  echo "💾 جارٍ حفظ التغييرات المعلّقة..."
  git add -A
  git commit -m "pre-shutdown save: $(date '+%Y-%m-%d %H:%M:%S')" --allow-empty-message 2>&1 | tail -2
  echo "✓ تم الحفظ"
fi

echo ""
echo "📜 آخر 5 التزامات:"
git log --oneline -5 2>/dev/null | sed 's/^/   /'

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✓ الفحص اكتمل — المشروع في حالة جيدة"
echo "═══════════════════════════════════════════════"
