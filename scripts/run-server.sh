#!/bin/bash
cd /home/z/my-project
while true; do
  npm run dev > /home/z/my-project/dev.log 2>&1
  echo "[watcher] Server exited at $(date), restarting in 3s..." >> /home/z/my-project/dev.log
  sleep 3
done
