@echo off
rem Makes .ovep files open in Open Video Editor and show its icon, for the current Windows user only (no admin).
setlocal
set "EXE=%~dp0Open Video Editor.exe"
if not exist "%EXE%" ( echo Open Video Editor.exe not found next to this script. & exit /b 1 )
reg add "HKCU\Software\Classes\.ovep" /ve /d "OpenVideoEditor.Project" /f >nul || exit /b 1
reg add "HKCU\Software\Classes\OpenVideoEditor.Project" /ve /d "Open Video Editor project" /f >nul
reg add "HKCU\Software\Classes\OpenVideoEditor.Project\DefaultIcon" /ve /d "\"%EXE%\",0" /f >nul
reg add "HKCU\Software\Classes\OpenVideoEditor.Project\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul
ie4uinit.exe -show >nul 2>&1
echo .ovep files now open with "%EXE%".
