@echo off
rem Removes the .ovep association that register-ovep.cmd added.
reg delete "HKCU\Software\Classes\OpenVideoEditor.Project" /f >nul 2>&1
reg delete "HKCU\Software\Classes\.ovep" /f >nul 2>&1
ie4uinit.exe -show >nul 2>&1
echo .ovep association removed.
