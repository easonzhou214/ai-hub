@echo off
setlocal EnableExtensions
title AI Hub
cd /d "%~dp0"

set "URL=http://127.0.0.1:5173/"
set "API=http://127.0.0.1:5173/api/cc-switch/providers"
set "MIN_MAJOR=22"
set "MIN_MINOR=13"

echo ==========================================
echo   AI Hub
echo ==========================================
echo.

rem Locate Node.js. nvm-windows and the official installer both put node on
rem PATH, but check the usual install locations as a fallback.
where node >nul 2>nul
if not errorlevel 1 goto :node_ready

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if defined NVM_SYMLINK if exist "%NVM_SYMLINK%\node.exe" set "PATH=%NVM_SYMLINK%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node 22.13 or newer:
  echo   https://nodejs.org/
  goto :fail
)

:node_ready
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VERSION=%%v"
if not defined NODE_VERSION (
  echo Could not read the Node.js version. Please check your Node installation.
  goto :fail
)
for /f "tokens=1,2 delims=." %%a in ("%NODE_VERSION%") do (
  set "NODE_MAJOR=%%a"
  set "NODE_MINOR=%%b"
)
if %NODE_MAJOR% LSS %MIN_MAJOR% goto :node_too_old
if %NODE_MAJOR% EQU %MIN_MAJOR% if %NODE_MINOR% LSS %MIN_MINOR% goto :node_too_old
echo Node: %NODE_VERSION%

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please check your Node/npm installation.
  goto :fail
)

rem Starting a second server would fail on port 5173. If AI Hub is already
rem running, just open the browser.
set "RUNNING="
where curl.exe >nul 2>nul
if errorlevel 1 goto :check_with_powershell
curl.exe -fsS --max-time 1 "%API%" >nul 2>nul
if not errorlevel 1 set "RUNNING=1"
goto :check_done

:check_with_powershell
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%API%' | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 set "RUNNING=1"

:check_done
if defined RUNNING (
  echo AI Hub is already running. Opening the browser...
  start "" "%URL%"
  echo.
  pause
  exit /b 0
)

if not exist "node_modules" (
  echo First start: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed. Check your network and try again.
    goto :fail
  )
)

rem Open the browser in the background as soon as the dev server answers.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%API%' | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Milliseconds 500 } }" >nul 2>nul

echo.
echo Starting: %URL%
echo Keep this window open. Close it or press Ctrl+C to stop.
echo.

call npm run dev

echo.
echo AI Hub stopped.
pause
exit /b 0

:node_too_old
echo Node %NODE_VERSION% is too old. Please install Node 22.13 or newer.
goto :fail

:fail
echo.
pause
exit /b 1
