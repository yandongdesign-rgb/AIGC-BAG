@echo off
cd /d "%~dp0"
start "" http://localhost:8765/
where python >nul 2>nul && (python -m http.server 8765 --bind 127.0.0.1 & goto :eof)
where py >nul 2>nul && (py -3 -m http.server 8765 --bind 127.0.0.1 & goto :eof)
npx --yes http-server -p 8765 -a 127.0.0.1 -c-1
