#!/bin/bash
# auto-push.sh — رفع تلقائي إلى GitHub بعد كل commit
#
# يتحقق من وجود commits محلية غير مرفوعة، وإذا وُجدت يرفعها.
# آمن: لا يفشل إذا لم تكن هناك تغييرات.

cd /home/z/my-project || exit 0

# تحقق من وجود commits غير مرفوعة
UNPUSHED=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l)

if [ "$UNPUSHED" -gt 0 ]; then
  echo "[auto-push] رفع $UNPUSHED commit إلى GitHub في $(date '+%Y-%m-%d %H:%M:%S')" >> /home/z/my-project/scripts/autosave.log
  git push origin main 2>&1 | tail -2 >> /home/z/my-project/scripts/autosave.log
else
  # لا توجد commits جديدة — لا شيء
  :
fi
