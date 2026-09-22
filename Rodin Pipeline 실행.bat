@echo off
chcp 65001 >nul
rem Rodin Pipeline launcher for Windows. Double-click this file.
cd /d "%~dp0"
echo == Rodin Pipeline ==
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  start https://nodejs.org
  pause
  exit /b 1
)
if exist .git (
  where git >nul 2>nul && (echo 최신 버전 확인 중... / checking for updates... & git pull --ff-only)
)
if not exist node_modules (
  echo 처음 실행입니다. 필요한 패키지를 설치합니다 ^(1~2분^)... / First run: installing packages...
)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo 설치에 실패했습니다 / install failed
  pause
  exit /b 1
)
echo.
echo 앱을 켭니다. 브라우저가 자동으로 열립니다. 이 창을 닫으면 앱이 꺼집니다.
echo Starting the app; the browser opens automatically. Closing this window stops the app.
echo.
call npm start
pause
