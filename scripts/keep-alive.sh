#!/bin/bash
# keep-alive.sh — keeps the dev server alive with self-pinging
cd /home/z/my-project
while true; do
  npm run dev > /home/z/my-project/dev.log 2>&1 &
  SERVER_PID=$!
  echo "[keep-alive] Started server PID: $SERVER_PID at $(date)"
  # Wait a bit then start pinging
  sleep 15
  # Ping every 20 seconds to keep the server warm + detect crashes
  while kill -0 $SERVER_PID 2>/dev/null; do
    curl -s --max-time 5 -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null
    sleep 20
  done
  echo "[keep-alive] Server died at $(date), restarting in 3s..."
  sleep 3
done
