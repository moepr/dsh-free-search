@echo off
chcp 65001 >nul
title dsh-free-search 引擎切换器
cd /d "%~dp0"

echo dsh-free-search 引擎切换器
echo.
echo   只修改 web-search-free 条目的 provider（引擎名）
echo   不修改 searchProvider（provider id）与 - id: web
echo.
echo 浏览器将打开 http://127.0.0.1:4789
echo 关闭此窗口即停止服务
echo.

start "" "http://127.0.0.1:4789"
node server.mjs %*

if errorlevel 1 (
  echo.
  echo 启动失败。可能是端口被占用，或本机没有 node。
  echo 可改用：node server.mjs --port 4790
)
pause
