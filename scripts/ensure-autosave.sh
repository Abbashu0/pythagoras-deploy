#!/bin/bash
# ensure-autosave.sh — تأكد من أن الـ daemon يعمل، وابدأه إذا لم يكن
#
# هذا السكريبت مصمم ليُستدعى عند بدء كل جلسة جديدة. يتحقق مما إذا كان
# الـ daemon يعمل، وإذا لم يكن، يبدأه. هكذا نضمن أن الـ daemon دائماً
# نشط حتى بعد إعادة تشغيل الحاسوب.
#
# ضعه في بداية كل جلسة عمل، أو اطلب من المساعد تشغيله عند بدء الحوار.

SCRIPT_DIR="/home/z/my-project/scripts"
PID_FILE="$SCRIPT_DIR/autosave.pid"

# تحقق مما إذا كان الـ daemon يعمل
if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
  # الـ daemon يعمل بالفعل — لا شيء
  exit 0
fi

# الـ daemon لا يعمل — ابدأه
setsid bash "$SCRIPT_DIR/autosave-daemon.sh" start > /dev/null 2>&1 < /dev/null &
sleep 1

# تحقق
if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
  echo "✓ بدأ الـ autosave daemon (PID $(cat $PID_FILE))"
else
  echo "⚠️  فشل بدء الـ daemon — تحقق من $SCRIPT_DIR/autosave.log"
fi
