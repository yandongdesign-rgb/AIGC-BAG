@echo off
cd /d "%~dp0"
where node >nul 2>nul && (start "" http://localhost:8765/ & node serve.mjs & goto :eof)
py -3 --version >nul 2>nul && (start "" http://localhost:8765/ & py -3 -m http.server 8765 --bind 127.0.0.1 & goto :eof)
python --version >nul 2>nul && (start "" http://localhost:8765/ & python -m http.server 8765 --bind 127.0.0.1 & goto :eof)
echo 需要 Node.js 或 Python 3；也可以直接双击 index.html
pause
