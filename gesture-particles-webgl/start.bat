@echo off
chcp 65001 >nul
cd /d %~dp0
echo 手势交互粒子引擎：正在启动本地服务 http://localhost:8000
start "" http://localhost:8000
python -m http.server 8000 || py -m http.server 8000
pause
