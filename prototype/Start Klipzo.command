#!/bin/sh
# Double-click to start the editor on this Mac. Close this window to stop it.
cd "$(dirname "$0")"
(sleep 1; open "http://localhost:8765") &
python3 -m http.server 8765 --bind 127.0.0.1
