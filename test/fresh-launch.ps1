param([string]$Dir, [int]$Port = 9333)
$env:PATH = 'C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0'
$env:APPDATA = 'D:\ove-fresh\profile\Roaming'; $env:LOCALAPPDATA = 'D:\ove-fresh\profile\Local'
$env:OVE_SAMPLES = 'C:\no-such-folder'; $env:OVE_INACTIVE = '1'
foreach ($v in 'NODE_PATH','FFMPEG_BIN','FFPROBE_BIN','OVE_CACHE','ELECTRON_RUN_AS_NODE','NODE_OPTIONS') { Remove-Item "env:$v" -ErrorAction SilentlyContinue }
$p = Start-Process -FilePath (Join-Path $Dir 'Open Video Editor.exe') -ArgumentList "--remote-debugging-port=$Port" -WorkingDirectory $Dir -PassThru
$p.Id
