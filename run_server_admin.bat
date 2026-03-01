@echo off
REM NTFS Extraction Server - Admin Launcher
REM This script ensures the server runs with Administrator privileges

echo.
echo ================================
echo NTFS Extraction API Server
echo ================================
echo.

REM Check if running as Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] ERROR: This script must be run as Administrator!
    echo.
    echo Solution:
    echo 1. Right-click Command Prompt
    echo 2. Select "Run as administrator"
    echo 3. Navigate to the project directory
    echo 4. Run this script again
    echo.
    pause
    exit /b 1
)

echo [+] Running with Administrator privileges
echo.

REM Navigate to backend directory
cd /d "%~dp0backend"

if errorlevel 1 (
    echo [!] ERROR: Could not navigate to backend directory
    pause
    exit /b 1
)

echo [*] Starting server on http://127.0.0.1:5000
echo [*] Press Ctrl+C to stop the server
echo.

REM Run the server with uvicorn
python -m uvicorn main:app --host 127.0.0.1 --port 5000 --reload

REM If server crashes or exits
if errorlevel 1 (
    echo.
    echo [!] Server exited with error
    echo.
)

pause
