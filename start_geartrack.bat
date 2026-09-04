@echo off
title GearTrack - Local Inventory & Scanner Server
color 0b

echo ======================================================
echo           GEARTRACK LOCAL INVENTORY SYSTEM
echo ======================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please download and install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b
)

:: 2. Check if dependencies are installed, install if missing
cd /d "%~dp0"
if not exist "node_modules\" (
    echo [INFO] First time setup: Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b
    )
    echo [INFO] Dependencies installed successfully.
    echo.
)

:: 3. Launch the browser automatically after 1.5 seconds in the background
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

:: 4. Start the Node.js server
echo [INFO] Starting GearTrack Server...
echo [INFO] Laptop Web Portal:     http://localhost:3000
echo [INFO] Press Ctrl+C in this window to stop the server.
echo.
echo ======================================================
node server/server.js

pause
