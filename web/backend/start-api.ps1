# 在「仓库根目录的 web 目录」下执行： .\backend\start-api.ps1
# 或：cd web\backend; .\start-api.ps1
$ErrorActionPreference = "Stop"
$backendDir = $PSScriptRoot
$webDir = Split-Path $backendDir -Parent
Set-Location $webDir
Write-Host "Starting Health Platform API from: $webDir" -ForegroundColor Cyan
Write-Host "After start, verify: http://127.0.0.1:8001/health  (buildId should be 2026-05-19-lab-ocr)" -ForegroundColor Yellow
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001 --app-dir backend
