#!/usr/bin/env bash
# 手势交互粒子引擎：启动本地服务并打开浏览器
cd "$(dirname "$0")"
PORT=${PORT:-8000}
echo "打开 http://localhost:$PORT  （Ctrl+C 退出）"
( sleep 1; (command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") ) >/dev/null 2>&1 &
python3 -m http.server "$PORT"
