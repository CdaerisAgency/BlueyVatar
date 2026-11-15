@echo off
setlocal EnableExtensions
rem blueyvatar deploy helper, v3
rem Syncs the local clone with origin/main, then deploys to Fly one app at a time: delivery, web, indexer.
rem Steps follow docs/deploy.md (Staging section and First-time setup). Tap is not deployed here.
rem After a production deploy, the last step runs "pnpm lexicons:publish" (docs/deploy.md, Publish lexicons). Skip it with --no-lexicons.
rem Run with --help for the options. Exit codes: 0 done, 1 failed, 2 bad usage, 3 stopped by the user.

set "REPO=C:\dev\blueyvatar"
set "URL=https://github.com/CdaerisAgency/BlueyVatar.git"
set "TARGET="
set "YES="
set "PRODOK="
set "NOPAUSE="
set "NOSYNC="
set "NOLEX="
set "INTERACTIVE=1"
set "RC=0"

rem ---- Read the options ----
:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="--env" goto :p_env
if /i "%~1"=="-e" goto :p_env
if /i "%~1"=="--yes" goto :p_yes
if /i "%~1"=="-y" goto :p_yes
if /i "%~1"=="--confirm-production" goto :p_prod
if /i "%~1"=="--no-pause" goto :p_nopause
if /i "%~1"=="--no-sync" goto :p_nosync
if /i "%~1"=="--no-lexicons" goto :p_nolex
if /i "%~1"=="--repo" goto :p_repo
if /i "%~1"=="--help" goto :usage_ok
if /i "%~1"=="-h" goto :usage_ok
if "%~1"=="/?" goto :usage_ok
echo Unknown option: %~1
goto :usage_bad

:p_env
if "%~2"=="" goto :usage_bad
set "TARGET=%~2"
shift
shift
goto :parse

:p_repo
if "%~2"=="" goto :usage_bad
set "REPO=%~2"
shift
shift
goto :parse

:p_yes
set "YES=1"
set "INTERACTIVE="
shift
goto :parse

:p_prod
set "PRODOK=1"
shift
goto :parse

:p_nopause
set "NOPAUSE=1"
shift
goto :parse

:p_nosync
set "NOSYNC=1"
shift
goto :parse

:p_nolex
set "NOLEX=1"
shift
goto :parse

:parsed
if not defined TARGET goto :target_checked
if /i "%TARGET%"=="staging" goto :target_checked
if /i "%TARGET%"=="production" goto :target_checked
if /i "%TARGET%"=="both" goto :target_checked
echo --env must be staging, production, or both.
goto :usage_bad
:target_checked

if not defined YES goto :yes_checked
if defined TARGET goto :yes_has_target
echo --yes needs --env, so the script knows where to deploy.
goto :usage_bad
:yes_has_target
set "WANTPROD="
if /i "%TARGET%"=="production" set "WANTPROD=1"
if /i "%TARGET%"=="both" set "WANTPROD=1"
if not defined WANTPROD goto :yes_checked
if defined PRODOK goto :yes_checked
echo Deploying to production without prompts needs --confirm-production as well.
goto :usage_bad
:yes_checked

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
if exist "%REPO%\.git" goto :havegit
if defined NOSYNC (
  echo No clone at %REPO% and --no-sync was given.
  goto :fail
)
echo No clone at %REPO%. Cloning...
git clone "%URL%" "%REPO%"
if errorlevel 1 goto :fail
:havegit

cd /d "%REPO%"
if errorlevel 1 goto :fail

if defined NOSYNC goto :synced

set "DIRTY="
for /f "delims=" %%i in ('git status --porcelain') do set "DIRTY=1"
if not defined DIRTY goto :clean
echo There are uncommitted changes in %REPO%. Commit or discard them first.
git status --short
goto :fail
:clean

rem Automatic cleanup is turned off for these commands. On Windows it can stop with a "Should I try again?" prompt when
rem another program (antivirus, an editor, a file indexer) holds a Git file open, which blocks an unattended run.
echo Syncing with origin/main...
git -c gc.auto=0 -c maintenance.auto=false fetch origin main
if errorlevel 1 goto :fail
git -c gc.auto=0 -c maintenance.auto=false checkout main
if errorlevel 1 goto :fail
git -c gc.auto=0 -c maintenance.auto=false pull --ff-only origin main
if errorlevel 1 goto :fail
:synced

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

rem ---- 3. Choose where to deploy ----
if defined TARGET goto :havetarget
choice /c SPBQ /m "Deploy to (S)taging, (P)roduction, (B)oth, or (Q)uit"
if errorlevel 4 goto :quit
if errorlevel 3 goto :pick_both
if errorlevel 2 goto :pick_prod
set "TARGET=staging"
goto :havetarget
:pick_both
set "TARGET=both"
goto :havetarget
:pick_prod
set "TARGET=production"
:havetarget

rem Production needs the typed phrase unless --confirm-production was given.
set "WANTPROD="
if /i "%TARGET%"=="production" set "WANTPROD=1"
if /i "%TARGET%"=="both" set "WANTPROD=1"
if not defined WANTPROD goto :prod_ok
if defined PRODOK goto :prod_ok
set "CONFIRM="
set /p "CONFIRM=Production is included. Type DEPLOY PRODUCTION to continue: "
if /i not "%CONFIRM%"=="DEPLOY PRODUCTION" goto :quit
:prod_ok

rem The lexicon step runs after production. Check what it needs now, so a deploy never finishes and then stops at the last step.
if not defined WANTPROD goto :lex_checked
if defined NOLEX goto :lex_checked
set "LEXMISS="
if not defined LEXICON_PUBLISH_IDENTIFIER set "LEXMISS=1"
if not defined LEXICON_PUBLISH_APP_PASSWORD set "LEXMISS=1"
if not defined LEXICON_PUBLISH_SERVICE set "LEXMISS=1"
if not defined LEXMISS goto :lex_env_ok
echo The lexicon step needs these environment variables, and these are not set:
if not defined LEXICON_PUBLISH_IDENTIFIER echo   LEXICON_PUBLISH_IDENTIFIER
if not defined LEXICON_PUBLISH_APP_PASSWORD echo   LEXICON_PUBLISH_APP_PASSWORD
if not defined LEXICON_PUBLISH_SERVICE echo   LEXICON_PUBLISH_SERVICE
echo Set them and start again, or pass --no-lexicons. Nothing was deployed.
goto :fail
:lex_env_ok
where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found on PATH, and the lexicon step needs it. Install pnpm or pass --no-lexicons. Nothing was deployed.
  goto :fail
)
:lex_checked

echo Target: %TARGET%
echo.

rem ---- 4. Deploy ----
if /i "%TARGET%"=="production" goto :run_prod

call :do_staging
if errorlevel 3 goto :quit
if errorlevel 1 goto :fail
if /i "%TARGET%"=="staging" goto :done

call :confirm "Staging finished. Deploy to production now"
if errorlevel 1 goto :quit

:run_prod
call :do_production
if errorlevel 3 goto :quit
if errorlevel 1 goto :fail

call :do_lexicons
if errorlevel 3 goto :quit
if errorlevel 1 goto :lexfail
goto :done

:done
echo.
echo Deploy finished. Check each site and "fly status" before you close this window.
set "RC=0"
goto :end

:quit
echo.
echo Stopped before finishing. Nothing after the last completed step was run.
set "RC=3"
goto :end

:fail
echo.
echo FAILED. Nothing further was run. Fix the problem above and run this file again.
echo If delivery failed during migrations, the previous version is still running.
set "RC=1"
goto :end

:lexfail
echo.
echo FAILED at the final step. The deploys already finished. Only the lexicon publish did not complete.
echo Fix the problem above, then run "pnpm lexicons:publish" from the repo root.
set "RC=1"
goto :end

:usage_ok
call :usage
set "RC=0"
goto :end

:usage_bad
echo.
call :usage
set "RC=2"
goto :end

:end
if defined NOPAUSE goto :leave
if not defined INTERACTIVE goto :leave
echo.
pause
:leave
endlocal & exit /b %RC%

rem ---- Subroutines. Each returns 0 done, 1 failed, 3 declined. ----

:usage
echo Usage: localdeploy.bat [--env staging^|production^|both] [--yes] [--confirm-production]
echo                        [--repo PATH] [--no-sync] [--no-pause] [--no-lexicons] [--help]
echo.
echo   --env NAME             staging, production, or both. Both deploys staging first, then production.
echo   --yes, -y              No prompts. Needs --env. Runs every step without asking.
echo   --confirm-production   Required with --yes when production is included. Replaces the typed phrase.
echo   --repo PATH            Use this clone instead of C:\dev\blueyvatar.
echo   --no-sync              Skip the fetch and pull. Deploys whatever is checked out.
echo   --no-pause             Do not wait for a key at the end.
echo   --no-lexicons          Do not publish lexicons after the production deploy.
echo.
echo After production, the last step runs "pnpm lexicons:publish". It needs the environment variables
echo LEXICON_PUBLISH_IDENTIFIER, LEXICON_PUBLISH_APP_PASSWORD, and LEXICON_PUBLISH_SERVICE. They are
echo checked before any deploy starts.
echo.
echo Examples:
echo   localdeploy.bat
echo   localdeploy.bat --env staging --yes
echo   localdeploy.bat --env both --yes --confirm-production
echo.
echo Exit codes: 0 done, 1 failed, 2 bad usage, 3 stopped by the user.
exit /b 0

:confirm
if defined YES exit /b 0
echo.
choice /c YN /m "%~1. Continue"
if errorlevel 2 exit /b 1
exit /b 0

:do_staging
echo.
echo --- STAGING ---
call :confirm "Step 1 of 3: deploy delivery to staging. This runs the database migrations first"
if errorlevel 1 exit /b 3
fly deploy --config fly/delivery.toml --app blueyvatar-delivery-staging --dockerfile Dockerfile --remote-only
if errorlevel 1 exit /b 1

call :confirm "Step 2 of 3: deploy web to staging"
if errorlevel 1 exit /b 3
fly deploy --config fly/web.toml --app blueyvatar-web-staging --dockerfile Dockerfile --remote-only
if errorlevel 1 exit /b 1

call :confirm "Step 3 of 3: deploy the indexer to staging"
if errorlevel 1 exit /b 3
fly deploy --config fly/indexer.toml --app blueyvatar-indexer-staging --dockerfile Dockerfile --remote-only --env TAP_URL=http://blueyvatar-tap-staging.internal:2480
if errorlevel 1 exit /b 1
exit /b 0

:do_production
echo.
echo --- PRODUCTION ---
call :confirm "Step 1 of 3: deploy delivery to production. This runs the database migrations first"
if errorlevel 1 exit /b 3
fly deploy --config fly/delivery.toml --dockerfile Dockerfile --remote-only
if errorlevel 1 exit /b 1

call :confirm "Step 2 of 3: deploy web to production"
if errorlevel 1 exit /b 3
fly deploy --config fly/web.toml --dockerfile Dockerfile --remote-only
if errorlevel 1 exit /b 1

call :confirm "Step 3 of 3: deploy the indexer to production"
if errorlevel 1 exit /b 3
fly deploy --config fly/indexer.toml --dockerfile Dockerfile --remote-only
if errorlevel 1 exit /b 1
exit /b 0

:do_lexicons
if not defined WANTPROD exit /b 0
if defined NOLEX (
  echo.
  echo Skipping the lexicon publish, as --no-lexicons was given.
  exit /b 0
)
echo.
echo --- LEXICONS ---
call :confirm "Final step: publish lexicons"
if errorlevel 1 exit /b 3
where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found on PATH.
  exit /b 1
)
call pnpm lexicons:publish
if errorlevel 1 exit /b 1
exit /b 0
