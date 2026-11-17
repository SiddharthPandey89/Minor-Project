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

:: ============================================================================
:: Step 2: Python virtual environment
:: ============================================================================
echo.
echo [INFO] Setting up Python virtual environment...

set "VENV_DIR=%ROOT%\geo-ml-service\.venv"
set "VENV_ACTIVATE=%VENV_DIR%\Scripts\activate.bat"

if not exist "%VENV_ACTIVATE%" (
    echo [INFO] Creating virtual environment at %VENV_DIR%...
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created
) else (
    echo [OK] Virtual environment already exists
    echo [INFO] Verifying pip is functional in existing virtual environment...
    "%VENV_DIR%\Scripts\python.exe" -m pip --version >nul 2>&1
    if errorlevel 1 (
        echo [WARN] pip is not functional in existing virtual environment. Repairing...
        "%VENV_DIR%\Scripts\python.exe" -m ensurepip --upgrade >nul 2>&1
        if errorlevel 1 (
            echo [WARN] ensurepip failed. Recreating virtual environment...
            rmdir /s /q "%VENV_DIR%"
            python -m venv "%VENV_DIR%"
            if errorlevel 1 (
                echo [ERROR] Failed to recreate virtual environment.
                pause
                exit /b 1
            )
            echo [OK] Virtual environment recreated
        )
        echo [OK] pip repaired in existing virtual environment
    )
)

echo [INFO] Installing Python dependencies (this may take a while)...
"%VENV_DIR%\Scripts\python.exe" -m pip install -r "%ROOT%\geo-ml-service\requirements.txt"
if errorlevel 1 (
    echo [ERROR] Failed to install Python dependencies.
    echo         Cannot continue without required Python packages.
    pause
    exit /b 1
) else (
    echo [OK] Python dependencies installed
)

:: ============================================================================
:: Step 3: npm dependencies
:: ============================================================================
echo.
echo [INFO] Installing npm dependencies (backend)...
cd /d "%ROOT%\backend"
CALL npm install
if errorlevel 1 (
    echo [ERROR] Failed to install backend npm dependencies.
    pause
    exit /b 1
)
echo [OK] Backend npm dependencies installed

echo [INFO] Installing npm dependencies (frontend)...
cd /d "%ROOT%\frontend"
CALL npm install
if errorlevel 1 (
    echo [ERROR] Failed to install frontend npm dependencies.
    pause
    exit /b 1
)
echo [OK] Frontend npm dependencies installed

:: ============================================================================
:: Step 4: Start ML service (port 8000)
:: ============================================================================
echo.
echo [INFO] Starting ML service on port 8000...
start "TERRAX-ML" /D "%ROOT%\geo-ml-service" "%VENV_DIR%\Scripts\python.exe" main.py
echo [OK] ML service window launched

:: ============================================================================
:: Step 5: Start Backend (port 5000)
:: ============================================================================
echo.
echo [INFO] Starting Backend on port 5000...
start "TERRAX-Backend" /D "%ROOT%\backend" npm start
echo [OK] Backend window launched

:: ============================================================================
:: Step 6: Start Frontend (port 5173)
:: ============================================================================
echo.
echo [INFO] Starting Frontend on port 5173...
start "TERRAX-Frontend" /D "%ROOT%\frontend" npm run dev
echo [OK] Frontend window launched

:: ============================================================================
:: Step 7: Wait for services to be ready, then open browser
:: ============================================================================
echo.
echo [INFO] Waiting for services to become ready...

set MAX_WAIT=120
set WAIT_COUNT=0

:wait_loop
if %WAIT_COUNT% GEQ %MAX_WAIT% goto timeout

set ALL_READY=1

curl.exe -s -f http://localhost:8000/health >nul 2>&1
if errorlevel 1 set ALL_READY=0

curl.exe -s -f http://localhost:5000/api/health >nul 2>&1
if errorlevel 1 set ALL_READY=0

curl.exe -s -f http://localhost:5173/ >nul 2>&1
if errorlevel 1 set ALL_READY=0

if %ALL_READY%==1 goto all_ready

set /a WAIT_COUNT+=1
timeout /t 2 /nobreak >nul
goto wait_loop

:all_ready
echo.
echo [OK] All services are ready!
echo.
echo [INFO] Opening TERRAX in your default browser...
start "" "http://localhost:5173/"
echo.
echo ============================================================================
echo  TERRAX is running!
echo    - ML Service:     http://localhost:8000/health
echo    - Backend:        http://localhost:5000/api/health
echo    - Frontend:       http://localhost:5173
echo ============================================================================
echo.
echo Each service runs in its own terminal window. Close those windows to stop.
echo Run STOP_TERRAX.bat to stop all services from this window.
echo.
goto end

:timeout
echo.
echo [WARN] Services did not become ready within %MAX_WAIT% seconds.
echo         They may still be starting. Check the individual terminal windows.
echo.
start "" "http://localhost:5173/"
goto end

:end
echo.
pause
