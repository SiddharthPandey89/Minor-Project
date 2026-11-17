@echo off
echo TERRAX Stop Services
echo.

netstat -ano | findstr ":8000" >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do taskkill /PID %%a /F >nul 2>&1
    echo Stopped ML service port 8000
) else (
    echo ML service not running
)

netstat -ano | findstr ":5000" >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000"') do taskkill /PID %%a /F >nul 2>&1
    echo Stopped Backend port 5000
) else (
    echo Backend not running
)

netstat -ano | findstr ":5173" >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173"') do taskkill /PID %%a /F >nul 2>&1
    echo Stopped Frontend port 5173
) else (
    echo Frontend not running
)

echo.
echo All TERRAX services have been stopped.
pause
