# MCP vs `ove` in Bash: one run each

Headless Claude Code (`claude -p`, default model, 2.1.288), run by `test/mcp-bench.sh <mcp|bash> <job1|job2>` on the 8 min clip `D:\OBS Videos\2023-08-16 23-55-20.mp4`. One run per cell, so treat differences as indicative only; the AI chose its own parameters each time (they differ between runs).
MCP route: only `mcp__ove__*` tools, server = `node.exe cli/mcp.js` from `D:\ove-test`, app running. Bash route: `Bash` + `Read`, `node cli/ove.js` under WSL.
Jobs: job1 = "remove the dead air from <clip> and show me"; job2 = "60 s reel of the loudest moments with dissolves, and show me".

| job | route | tool calls* | API turns | new input | cache write | cache read | output | cost USD | wall s |
|---|---|---|---|---|---|---|---|---|---|
| job1 | mcp | 9 | 11 | 322 | 20,994 | 278,833 | 3,851 | 0.69 | 52 |
| job1 | bash | 7 | 8 | 226 | 32,286 | 195,538 | 2,556 | 0.82 | 45 |
| job2 | mcp | 28 | 10 | 290 | 20,844 | 252,612 | 3,896 | 0.68 | 50 |
| job2 | bash | 10 | 11 | 322 | 21,952 | 302,198 | 3,746 | 0.71 | 60 |

\* tool_use blocks excluding `ToolSearch`. Parallel calls in one turn count separately, so calls can exceed turns.
Token columns are the `result` line's `usage` in `cache/bench/*.jsonl` (an earlier version of this report summed per-message stream usage and showed output as ~500; that undercounted, the real figures are above). Cost is Claude Code's `total_cost_usd`. New input = uncached input; cache write = context added to the cache (billed ~1.25x input); cache read = the whole earlier context re-read each turn (billed ~0.1x input); output is the most expensive per token.

Why MCP is not clearly cheaper, and where the difference comes from: the MCP route has more tokens and (job2) more calls, yet costs about the same or a little less. Reading cost is cheap (cache read), so the extra 80K of cache reads on job1-mcp costs little. The money is in cache writes and output. In job1 the Bash route wrote 11K more tokens into the cache (raw command output and `ove help` text) while MCP wrote 21K; MCP wrote 1.3K more output tokens (thinking 1,812 vs 134). Net: job1 0.69 vs 0.82, job2 0.68 vs 0.71. The job2 gap is inside noise; with one run per cell, "MCP is cheaper" is not shown, only "not more expensive". MCP calls are cheap per call but job2 used 28 of them (one per edit), while Bash batches many edits in one call.

Standing cost of having the server installed (Claude Code 2.1.288, `claude -p "/context"` and a one-word prompt, no call to the server, `--strict-mcp-config`):
- With `ove`: first-message input 26,502 tokens (2 new + 26,500 cache write). Without: 26,066 (2 + 9,232 write + 16,832 read). Difference: about +440 tokens per message, which is the deferred-tool name list. The 39 tool schemas (3.8K tokens, `/context` "MCP tools (deferred)") are only loaded into the context when the AI searches for them (ToolSearch), so you pay them once in a session that uses the server, and nothing in a session that does not.
- Tool list size: `/context` sums the `mcp__ove__*` tools to 3,811 tokens (was 5,218 before trimming `$schema`, the hidden `silent`/`budget`/`bg` fields and long descriptions; those fields are still accepted).

Results (all four `.ovep` in `D:\ove-test\cache\bench\`, `check` run through the MCP after the runs: `{"ok":1,"n":0,"f":[]}` for each):
- job1-mcp.ovep 386.6 s (98 clips), job1-bash.ovep 389.5 s (110 clips); source 474.2 s.
- job2-mcp.ovep 60 s, 0.5 s dissolves; job2-bash.ovep 60 s, 1 s dissolves.
- MCP route ended with the project open in the app (job2: playhead 42.25 s, the AI's own capture target restored the playhead only after this was fixed; job1 was run before `app_open` parked on the first cut, a later `project_open` + `app_open` on job1-mcp.ovep gave playhead 2.71 = first cut, `test/mcp-first-cut.mjs`). The Bash route ends with "open it with Ctrl+O".
- Bash-route friction seen: unquoted Windows path with a space split an import in job1-bash (one failed batch line); MCP route paid for 1-2 `ove help` calls and a wrong `set project` guess.
