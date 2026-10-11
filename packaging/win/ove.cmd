@echo off
rem ove CLI from the portable zip: runs cli\ove.js with the bundled Electron in Node mode (no Node install needed).
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0Open Video Editor.exe" "%~dp0resources\app.asar\cli\ove.js" %*
exit /b %errorlevel%
