@echo off
title BrandForge
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Download the LTS version from:
  echo   https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing BrandForge... this only happens the first time.
  call npm install
)

echo.
echo   Starting BrandForge... your browser will open in a few seconds.
echo   KEEP THIS WINDOW OPEN while you use the app.
echo   Close this window to stop the app.
echo.

start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm start
pause
