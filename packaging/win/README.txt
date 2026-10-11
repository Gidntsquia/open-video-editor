Open Video Editor 0.1.0 (portable)

Open Video Editor.exe   The editor. Double-click to start.
ove.cmd                 The ove CLI:  ove.cmd help
ove-mcp.cmd             The MCP server for Claude Code and other MCP clients (stdio).
register-ovep.cmd       Makes .ovep project files open in the editor and show its icon (current user, no admin).
unregister-ovep.cmd     Removes that association.

Nothing else needs to be installed: Electron, ffmpeg and ffprobe are in this folder.
Thumbnails, waveforms, proxies and export temp files go to the cache folder here (2 GB cap,
emptied by the Clear cache button in the toolbar). If this folder is read-only they go to
%LOCALAPPDATA%\Open Video Editor\cache instead.

Claude Code MCP setup (.mcp.json in your project folder, use your unzip path):
{ "mcpServers": { "ove": { "command": "cmd", "args": ["/c", "C:\\Tools\\Open-Video-Editor\\ove-mcp.cmd"] } } }

Source, docs and issues: https://github.com/Gidntsquia/open-video-editor
