#!/bin/sh
cd "$(dirname "$0")"
URL=http://localhost:8765/
( sleep 1; (command -v xdg-open >/dev/null && xdg-open $URL) || open $URL ) >/dev/null 2>&1 &
if command -v python3 >/dev/null; then exec python3 -m http.server 8765 --bind 127.0.0.1
elif command -v node >/dev/null; then exec node serve.mjs
else echo "需要 Python 3 或 Node.js；也可以直接双击 index.html"; exit 1; fi
