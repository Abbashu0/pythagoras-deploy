#!/bin/bash
cd /home/z/my-project/pythagoras-app/Pythagoras-App
exec python3 -m http.server 3000 --bind 0.0.0.0
