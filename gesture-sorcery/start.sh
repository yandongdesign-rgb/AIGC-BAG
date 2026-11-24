#!/bin/sh
cd "$(dirname "$0")"
URL=http://localhost:8765/
( sleep 1; (command -v xdg-open >/dev/null && xdg-open $URL) || open $URL ) >/dev/null 2>&1 &
if command -v python3 >/dev/null; then exec python3 -m http.server 8765 --bind 127.0.0.1
else exec npx --yes http-server -p 8765 -a 127.0.0.1 -c-1; fi
