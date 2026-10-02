# MCP vs `ove` in Bash: one run each

Headless Claude Code (`claude -p`, default model, 2.1.288), run by `test/mcp-bench.sh <mcp|bash> <job1|job2>` on the 8 min clip `D:\OBS Videos\2023-08-16 23-55-20.mp4`. One run per cell, so treat differences as indicative only; the AI chose its own parameters each time (they differ between runs).
MCP route: only `mcp__ove__*` tools, server = `node.exe cli/mcp.js` from `D:\ove-test`, app running. Bash route: `Bash` + `Read`, `node cli/ove.js` under WSL.
Jobs: job1 = "remove the dead air from <clip> and show me"; job2 = "60 s reel of the loudest moments with dissolves, and show me".

| job | route | tool calls* | API turns | input-side tokens** | output tokens | cost USD | wall s |
|---|---|---|---|---|---|---|---|
| job1 | mcp | 9 | 11 | 300,149 | 491 | 0.69 | 52 |
| job1 | bash | 7 | 8 | 228,050 | 395 | 0.82 | 45 |
| job2 | mcp | 28 | 10 | 273,746 | 524 | 0.68 | 50 |
| job2 | bash | 10 | 11 | 324,472 | 621 | 0.71 | 60 |

\* tool_use blocks excluding `ToolSearch` (Claude Code loads MCP tool schemas on demand through it: 1-2 extra calls on the MCP route). Parallel calls in one turn count separately, so calls can exceed turns.
\** input + cache-write + cache-read tokens summed over all API turns (the whole context is re-read each turn). Output tokens are what the model wrote. Cost is Claude Code's own `total_cost_usd`.

Results (all four `.ovep` in `D:\ove-test\cache\bench\`, `check` run through the MCP after the runs: `{"ok":1,"n":0,"f":[]}` for each):
- job1-mcp.ovep 386.6 s (98 clips), job1-bash.ovep 389.5 s (110 clips); source 474.2 s.
- job2-mcp.ovep 60 s, 0.5 s dissolves; job2-bash.ovep 60 s, 1 s dissolves.
- MCP route ended with the project open in the app (job2: playhead 42.25 s, the AI's own capture target restored the playhead only after this was fixed; job1 was run before `app_open` parked on the first cut, a later `project_open` + `app_open` on job1-mcp.ovep gave playhead 2.71 = first cut, `test/mcp-first-cut.mjs`). The Bash route ends with "open it with Ctrl+O".
- Tool-list cost: `tools/list` is 10.8 K characters (about 3.4 K tokens at 3.2 chars/token; not counted with a real tokenizer).
- Bash-route friction seen: unquoted Windows path with a space split an import in job1-bash (one failed batch line); MCP route paid for 1-2 `ove help` calls and a wrong `set project` guess.
