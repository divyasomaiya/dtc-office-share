@echo off
title DTC Office Share Server
setlocal enabledelayedexpansion

:: Resolve project root directory regardless of current working directory
cd /d "%~dp0.."

echo ====================================================
echo             DTC Office Share - Phase 1
echo ====================================================
echo Project root: %CD%
echo Starting local signaling and web server...
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js (version 18 or newer) from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

:: Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not found in your PATH.
    pause
    exit /b 1
)

:: Check if dependencies are installed
if not exist "node_modules\ws" (
    echo [INFO] Installing required production dependencies...
    call npm install --production
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] npm install failed. Please check your network connection or npm configuration.
        pause
        exit /b 1
    )
)

:: Set default port if not provided in environment
if "%PORT%"=="" set PORT=3000
if "%HOST%"=="" set HOST=0.0.0.0

echo Bound to %HOST%:%PORT%
node src\server.js

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Server exited with code %ERRORLEVEL%.
    pause
)
