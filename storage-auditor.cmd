@echo off
setlocal
cd /d "%~dp0"
if not exist "dist\tools\storage-growth-tools.js" (
  echo [Storage Auditor] Compilando Bridge una sola vez porque falta dist...
  call npm run build || exit /b 1
)
node scripts\storage-auditor-app.mjs --open
