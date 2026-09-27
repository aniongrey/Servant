@echo off
setlocal
cd /d "%~dp0"

set /p "message=Commit message: "
if not defined message (
  echo Commit message cannot be empty.
  pause
  exit /b 1
)

git add -A
if errorlevel 1 goto failed

git diff --cached --quiet
if not errorlevel 1 (
  echo Nothing to commit.
  pause
  exit /b 0
)

git commit -m "%message%"
if errorlevel 1 goto failed

echo.
echo Commit completed.
pause
exit /b 0

:failed
echo.
echo Git command failed.
pause
exit /b 1
