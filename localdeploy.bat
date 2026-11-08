@echo off
setlocal EnableExtensions
rem blueyvatar deploy helper, v1
rem Syncs C:\dev\blueyvatar with origin/main, then walks through the Fly deploy one app at a time.
rem Steps follow docs/deploy.md (Staging section and First-time setup). Tap is not deployed here.

set "REPO=C:\dev\blueyvatar"
set "URL=https://github.com/CdaerisAgency/BlueyVatar.git"

echo.
echo === blueyvatar deploy ===
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo git was not found on PATH.
  goto :fail
)
where fly >nul 2>&1
if errorlevel 1 (
  echo fly was not found on PATH. Install flyctl and run "fly auth login".
  goto :fail
)

rem ---- 1. Sync the repo ----
if not exist "%REPO%\.git" (
  echo No clone at %REPO%. Cloning...
  git clone "%URL%" "%REPO%"
  if errorlevel 1 goto :fail
)

cd /d "%REPO%"
if errorlevel 1 goto :fail

set "DIRTY="
for /f "delims=" %%i in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY (
  echo There are uncommitted changes in %REPO%. Commit or discard them first.
  git status --short
  goto :fail
)

echo Syncing with origin/main...
git fetch origin main
if errorlevel 1 goto :fail
git checkout main
if errorlevel 1 goto :fail
git pull --ff-only origin main
if errorlevel 1 goto :fail

echo.
git log -1 --format="Deploying commit %%h: %%s (%%cd)"
echo.

rem ---- 2. Check the Fly login ----
echo Signed in to Fly as:
fly auth whoami
if errorlevel 1 (
  echo Run "fly auth login" and start again.
  goto :fail
)
echo.

rem ---- 3. Choose the environment ----
choice /c SPQ /m "Deploy to (S)taging, (P)roduction, or (Q)uit"
if errorlevel 3 goto :quit
if errorlevel 2 goto :production
goto :staging

:staging
echo.
echo --- STAGING ---
call :confirm "Step 1 of 3: deploy delivery to staging. This runs the database migrations first"
if errorlevel 1 goto :quit
fly deploy --config fly/delivery.toml --app blueyvatar-delivery-staging --dockerfile Dockerfile --remote-only
if errorlevel 1 goto :fail

call :confirm "Step 2 of 3: deploy web to staging"
if errorlevel 1 goto :quit
fly deploy --config fly/web.toml --app blueyvatar-web-staging --dockerfile Dockerfile --remote-only
if errorlevel 1 goto :fail

call :confirm "Step 3 of 3: deploy the indexer to staging"
if errorlevel 1 goto :quit
fly deploy --config fly/indexer.toml --app blueyvatar-indexer-staging --dockerfile Dockerfile --remote-only --env TAP_URL=http://blueyvatar-tap-staging.internal:2480
if errorlevel 1 goto :fail
goto :done

:production
echo.
echo --- PRODUCTION ---
set "CONFIRM="
set /p "CONFIRM=Type DEPLOY PRODUCTION to continue: "
if /i not "%CONFIRM%"=="DEPLOY PRODUCTION" goto :quit

call :confirm "Step 1 of 3: deploy delivery to production. This runs the database migrations first"
if errorlevel 1 goto :quit
fly deploy --config fly/delivery.toml --dockerfile Dockerfile --remote-only
if errorlevel 1 goto :fail

call :confirm "Step 2 of 3: deploy web to production"
if errorlevel 1 goto :quit
fly deploy --config fly/web.toml --dockerfile Dockerfile --remote-only
if errorlevel 1 goto :fail

call :confirm "Step 3 of 3: deploy the indexer to production"
if errorlevel 1 goto :quit
fly deploy --config fly/indexer.toml --dockerfile Dockerfile --remote-only
if errorlevel 1 goto :fail
goto :done

:confirm
echo.
choice /c YN /m "%~1. Continue"
if errorlevel 2 exit /b 1
exit /b 0

:done
echo.
echo All three apps deployed. Check each site and "fly status" before you close this window.
goto :end

:quit
echo.
echo Stopped before finishing. Nothing after the last completed step was run.
goto :end

:fail
echo.
echo FAILED. Nothing further was run. Fix the problem above and run this file again.
echo If delivery failed during migrations, the previous version is still running.

:end
echo.
pause
endlocal
