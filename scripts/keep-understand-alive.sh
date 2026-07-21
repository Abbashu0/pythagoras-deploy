#!/bin/bash
# keep-understand-alive.sh — keeps the Understand Anything viewer running
cd /home/z/my-project
while true; do
  UNDERSTAND_ACCESS_TOKEN="pythagoras-demo" node /home/z/.understand-anything/repo/understand-anything-plugin/packages/viewer/bin/viewer.mjs /home/z/my-project --port 5174 --no-open > /home/z/my-project/understand-viewer.log 2>&1
  sleep 2
done
