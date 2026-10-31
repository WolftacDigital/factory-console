@echo off
REM Wolftac Factory Console - read-only local service on http://127.0.0.1:8095
cd /d "%~dp0"
if not exist node_modules call bun install
if not exist dist\index.html call bun run build
start "" http://127.0.0.1:8095
bun run start
