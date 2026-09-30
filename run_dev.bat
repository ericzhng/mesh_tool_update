@echo off
setlocal

cd /d "%~dp0"

echo Checking dependencies...
python -c "import flask, flask_socketio, numpy, yaml, rich" 2>nul
if errorlevel 1 (
    echo Installing dependencies from requirements.txt...
    python -m pip install -r requirements.txt
)

set PYTHONPATH=%~dp0src
set DATA_DIR=%~dp0.pmf_dev_data
set HOST=127.0.0.1
set PORT=5050
set URL=http://%HOST%:%PORT%/

echo.
echo Starting PlaneMeshForge (dev mode, no install)...
echo Data dir: %DATA_DIR%
echo Will open %URL% in your browser once the server is ready.
echo Press Ctrl+C to stop.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command ^
    "for ($i = 0; $i -lt 30; $i++) { try { Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 1 | Out-Null; Start-Process '%URL%'; exit } catch { Start-Sleep -Seconds 1 } }"

python -m planemeshforge --debug --host %HOST% --port %PORT% --data-dir "%DATA_DIR%"

echo.
echo Server stopped.
pause
