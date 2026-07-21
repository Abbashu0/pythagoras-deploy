#!/bin/bash
# keep-alive.sh — production server with auto-restart
cd /home/z/my-project
while true; do
  echo "[keep-alive] Starting production server at $(date)"
  npm run start > /home/z/my-project/dev.log 2>&1
  echo "[keep-alive] Server died at $(date), restarting in 2s..."
  sleep 2
done
