#!/bin/bash
# autosave-daemon.sh — حفظ تلقائي صامت كل 5 دقائق
INTERVAL=300
PROJECT_DIR="/home/z/my-project"
LOG_FILE="$PROJECT_DIR/scripts/autosave.log"
PID_FILE="$PROJECT_DIR/scripts/autosave.pid"

case "$1" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
      echo "⚠️  الـ daemon يعمل بالفعل (PID $(cat $PID_FILE))"
      exit 0
    fi
    (
      echo "[autosave] بدأ الـ daemon في $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
      while true; do
        sleep "$INTERVAL"
        cd "$PROJECT_DIR" || exit 1
        if git diff --quiet HEAD 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard)" ]; then
          :
        else
          git add -A
          TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
          git commit -m "auto-save: $TIMESTAMP" --allow-empty-message 2>&1 | tail -1 >> "$LOG_FILE"
          echo "[autosave] تم الحفظ التلقائي في $TIMESTAMP" >> "$LOG_FILE"
        fi
        # رفع تلقائي إلى GitHub بعد كل فحص (آمن: لا يرفع إذا لم تكن هناك commits جديدة)
        bash "$PROJECT_DIR/scripts/auto-push.sh" 2>&1 >> "$LOG_FILE"
      done
    ) &
    DAEMON_PID=$!
    echo "$DAEMON_PID" > "$PID_FILE"
    disown $DAEMON_PID 2>/dev/null || true
    echo "✓ بدأ الـ daemon (PID $DAEMON_PID) — يحفظ كل $INTERVAL ثانية"
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null
        rm -f "$PID_FILE"
        echo "✓ تم إيقاف الـ daemon (PID $PID)"
      else
        rm -f "$PID_FILE"
        echo "⚠️  الـ daemon ليس قيد التشغيل"
      fi
    else
      echo "⚠️  الـ daemon ليس قيد التشغيل"
    fi
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
      echo "✓ الـ daemon يعمل (PID $(cat $PID_FILE))"
      tail -5 "$LOG_FILE" 2>/dev/null | sed 's/^/    /'
    else
      echo "✗ الـ daemon لا يعمل"
    fi
    ;;
  *)
    echo "الاستخدام: $0 {start|stop|status}"
    exit 1
    ;;
esac
