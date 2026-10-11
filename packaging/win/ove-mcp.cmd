@echo off
rem MCP server (stdio) from the portable zip: runs cli\mcp.js with the bundled Electron in Node mode.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0Open Video Editor.exe" "%~dp0resources\app.asar\cli\mcp.js" %*
exit /b %errorlevel%
