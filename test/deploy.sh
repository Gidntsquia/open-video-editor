#!/bin/bash
# WSL: build, sync to D:\ove-test, relaunch Electron there without taking focus (CDP on 9222).
cd "$(dirname "$0")/.." && npx vite build >/dev/null && rsync -a --delete --exclude node_modules --exclude cache --exclude .git --exclude plans ./ /mnt/d/ove-test/ || exit 1
powershell.exe -c "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force" >/dev/null 2>&1; sleep 1
powershell.exe -c "\$env:OVE_INACTIVE='1'; Start-Process -WindowStyle Minimized -FilePath 'D:\ove-test\node_modules\electron\dist\electron.exe' -ArgumentList '--remote-debugging-port=9222','D:\ove-test' -WorkingDirectory 'D:\ove-test'"
sleep 8
