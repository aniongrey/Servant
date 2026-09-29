@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ===========================================================================
rem  Servant release build launcher.
rem
rem    rundeskbuild.bat           full release - exe + MSI + NSIS installer
rem    rundeskbuild.bat nsis      NSIS installer only - skips the WiX pass
rem    rundeskbuild.bat msi       MSI installer only - skips the NSIS pass
rem    rundeskbuild.bat fast      portable folder, no installer at all
rem    rundeskbuild.bat check     run the preflight checks and stop
rem    rundeskbuild.bat -h        this help
rem
rem  Why the window looks frozen near the end: WiX and NSIS compress the whole
rem  payload, one installer at a time, and Tauri does not forward their output.
rem  The last ~2 minutes of a full build print nothing at all. That is normal.
rem  Build only one installer - nsis or msi - to halve that silence.
rem
rem  No EnableDelayedExpansion on purpose: it swallows every "!" in echoed text.
rem  Nothing here needs it - "if defined" is evaluated at run time anyway.
rem ===========================================================================

rem --- argument: MODE stays undefined for anything we do not recognise --------
set "MODE="
if "%~1"=="" set "MODE=full"
if /i "%~1"=="full"  set "MODE=full"
if /i "%~1"=="nsis"  set "MODE=nsis"
if /i "%~1"=="msi"   set "MODE=msi"
if /i "%~1"=="fast"  set "MODE=fast"
if /i "%~1"=="check" set "MODE=check"
if /i "%~1"=="-h"     goto :help
if /i "%~1"=="--help" goto :help
if /i "%~1"=="?"      goto :help
if not defined MODE goto :badarg

echo.
echo === Servant build ===
echo   root : %CD%
echo   mode : %MODE%
echo.

rem ---------------------------------------------------------------------------
rem  Preflight: the things that actually break or stall this build.
rem    - the app running from target\release, which is patched and relinked in place
rem    - a dev or preview server on 5173, which owns the same dist\ folder
rem    - node_modules missing, which is what "npm run" would otherwise say
rem ---------------------------------------------------------------------------

where npm >nul 2>nul
if errorlevel 1 goto :no_npm
if not exist "package.json" goto :wrong_dir
if not exist "src-tauri\tauri.conf.json" goto :wrong_dir
if not exist "node_modules\@tauri-apps\cli\tauri.js" goto :no_modules

tasklist /FI "IMAGENAME eq servant-desktop.exe" /NH 2>nul | findstr /i /c:"servant-desktop.exe" >nul 2>nul
if not errorlevel 1 (
  echo [!] servant-desktop.exe is running.
  echo     Harmless if it is an installed copy or the one in dist-fast\Servant.
  echo     Fatal if it is src-tauri\target\release\servant-desktop.exe, because
  echo     that file is patched and relinked in place. Close it and run again.
)

netstat -ano 2>nul | findstr /c:":5173 " >nul 2>nul
if not errorlevel 1 (
  echo [!] Something is listening on 5173 - a dev or a preview server.
  echo     It owns the dist\ folder this build rewrites, and a live tauri:fast
  echo     session can hold the cargo lock. Close it first.
)

echo What to expect on a warm cache:
echo   frontend    ~15 s
echo   sidecar     ~20 s
echo   rust        1-2 min, much longer after a clean or a fresh git checkout
echo   packagers   ~2 min for both installers with NO OUTPUT AT ALL
echo.
echo If it stays silent for more than ~5 minutes, open a second window and run:
echo   tasklist /FI "IMAGENAME eq light.exe"        also try makensis.exe
echo   memory climbing  = it is compressing, just wait
echo   process missing  = look here for "waiting for file lock on build directory"
echo.

if /i "%MODE%"=="check" goto :check_done

if /i "%MODE%"=="fast" goto :run_fast
if /i "%MODE%"=="nsis" goto :run_nsis
if /i "%MODE%"=="msi"  goto :run_msi
goto :run_full

:run_fast
echo === npm run build:fast ===
call npm run build:fast
set "RC=%errorlevel%"
goto :after_build

:run_nsis
echo === tauri build --bundles nsis ===
call node "node_modules\@tauri-apps\cli\tauri.js" build --bundles nsis
set "RC=%errorlevel%"
goto :after_build

:run_msi
echo === tauri build --bundles msi ===
call node "node_modules\@tauri-apps\cli\tauri.js" build --bundles msi
set "RC=%errorlevel%"
goto :after_build

:run_full
echo === npm run tauri:build ===
call npm run tauri:build
set "RC=%errorlevel%"

:after_build
if not "%RC%"=="0" (
  echo.
  echo [x] Build failed with exit code %RC%.
  goto :done
)

echo.
echo === Build finished ===
if /i "%MODE%"=="fast" goto :show_fast

call :size "src-tauri\target\release\servant-desktop.exe" "app  "
if /i "%MODE%"=="nsis" goto :show_nsis
if /i "%MODE%"=="msi"  goto :show_msi
call :size "src-tauri\target\release\bundle\msi\*.msi" "msi  "
call :size "src-tauri\target\release\bundle\nsis\*-setup.exe" "setup"
goto :artifacts_done

:show_nsis
call :size "src-tauri\target\release\bundle\nsis\*-setup.exe" "setup"
goto :artifacts_done

:show_msi
call :size "src-tauri\target\release\bundle\msi\*.msi" "msi  "
goto :artifacts_done

:show_fast
echo   folder : %CD%\dist-fast\Servant
echo   run    : %CD%\dist-fast\Servant\Servant.exe

:artifacts_done
echo   timestamps tell you which of these this run actually produced.
set "RC=0"
goto :done

:check_done
echo Preflight finished. Nothing was built.
set "RC=0"
goto :done

rem --- print one artifact line: :size <glob> <label> -------------------------
:size
set "FOUND="
for %%F in (%~1) do (
  set "FOUND=1"
  echo   %~2 : %%~nxF  %%~zF bytes  @%%~tF
)
if not defined FOUND echo   %~2 : not found - %~1
goto :eof

:no_npm
echo [x] npm was not found on PATH. Install Node.js and reopen this window.
set "RC=1"
goto :done

:no_modules
echo [x] node_modules\@tauri-apps\cli\tauri.js is missing - run "npm install".
set "RC=1"
goto :done

:wrong_dir
echo [x] %CD% is not the Servant repo root.
echo     This script must sit next to package.json and src-tauri\.
set "RC=1"
goto :done

:help
set "RC=0"
goto :usage

:badarg
echo.
echo [x] Unknown argument: %~1
set "RC=1"

:usage
echo.
echo Usage: rundeskbuild.bat [full^|nsis^|msi^|fast^|check^|-h]
echo   no argument   full release - exe, MSI and NSIS installer
echo   nsis          NSIS installer only, skips the WiX pass
echo   msi           MSI installer only, skips the NSIS pass
echo   fast          portable folder only, no installer
echo   check         run the preflight checks and stop
echo   -h            this help
goto :done

:done
echo.
pause
endlocal & exit /b %RC%
