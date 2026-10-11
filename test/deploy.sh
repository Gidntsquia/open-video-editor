#!/bin/bash
# WSL: build, sync to D:\ove-test, relaunch Electron there without taking focus (CDP on 9222).
cd "$(dirname "$0")/.." && npx vite build >/dev/null && rsync -a --delete --exclude node_modules --exclude cache --exclude .git --exclude plans ./ /mnt/d/ove-test/ || exit 1
# Only stop Electron started from D:\ove-test; other Electron apps (and their CDP ports) belong to the user.
powershell.exe -c "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { \$_.ExecutablePath -like 'D:\\ove-test\\*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1; sleep 1
powershell.exe -c "\$env:OVE_INACTIVE='1'; Start-Process -FilePath 'D:\ove-test\node_modules\electron\dist\electron.exe' -ArgumentList '--remote-debugging-port=${PORT:-9222}','D:\ove-test' -WorkingDirectory 'D:\ove-test'"
sleep 8
