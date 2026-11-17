@echo off
setlocal enabledelayedexpansion

echo.
echo ============================================================================
echo  TERRAX - Earth GeoIntelligence Platform - Startup
echo ============================================================================
echo.

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
echo [INFO] Project root: %ROOT%

echo [INFO] Checking required software...

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found
    pause
    exit /b 1
)
echo [OK] Python found

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found
    pause
    exit /b 1
)
echo [OK] Node.js found

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found
    pause
    exit /b 1
)
echo [OK] npm found

echo.
echo [INFO] All checks passed.
