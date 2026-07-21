#!/bin/bash
# start-all.sh — start both Next.js and Understand viewer independently

# Start Understand viewer (independent background process)
(
  while true; do
    UNDERSTAND_ACCESS_TOKEN="pythagoras-demo" node /home/z/.understand-anything/repo/understand-anything-plugin/packages/viewer/bin/viewer.mjs /home/z/my-project --port 5174 --no-open > /home/z/my-project/understand-viewer.log 2>&1
    sleep 2
  done
) &

# Start Next.js production server (independent background process)
(
  cd /home/z/my-project
  while true; do
    npm run start > /home/z/my-project/dev.log 2>&1
    sleep 2
  done
) &

# Keep the script alive
while true; do
  sleep 60
done
