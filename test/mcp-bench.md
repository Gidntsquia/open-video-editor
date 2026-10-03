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

## Cost per token category (USD)

Rates fitted from the five `result` lines in `cache/bench/*.jsonl` (exact fit, error < 1e-14): new input $10 / M tokens, cache write $20 / M, cache read $0.25 / M, output $50 / M. Each row below is tokens x rate; the columns add up to `total_cost_usd`.

| job | route | new input | cache write | cache read | output | sum | total_cost_usd |
|---|---|---|---|---|---|---|---|
| job1 | mcp | 0.003 | 0.420 | 0.070 | 0.193 | 0.685 | 0.685 |
| job1 | bash | 0.002 | 0.646 | 0.049 | 0.128 | 0.825 | 0.825 |
| job2 | mcp | 0.003 | 0.417 | 0.063 | 0.195 | 0.678 | 0.678 |
| job2 | bash | 0.003 | 0.439 | 0.076 | 0.187 | 0.705 | 0.705 |

Why more tokens can cost less: a token is not a unit of cost. Cache read is 80x cheaper than output and 80x cheaper than cache write, and 90 % of all tokens are cache reads. job1: MCP read 83K more tokens than Bash (+$0.02) but wrote 11K fewer (-$0.23) and output 1.3K more (+$0.06). Net -$0.14. The MCP route wins job1 because it pasted less raw command output and `ove help` text into the context (cache write), not because it used fewer tokens. job2: reads -$0.01, writes -$0.02, output +$0.01; a $0.03 difference from one run each, which is noise.

## Standing cost of having `ove` installed, in the same units

Scope: `ove` is registered in this repo's `.mcp.json`, not in the user config, so only sessions started in this project pay for it. The user works here only on video-editor tasks and elsewhere for everything else, so every session that carries the cost is a video-editor session; no sessions outside it are charged.

The server adds about 440 tokens (the deferred tool-name list) to the context of every such session, whether or not it is called. Billing: once per session as a cache write (440 x $20 / M = $0.0088), then on each later message as a cache read (440 x $0.25 / M = $0.00011). The write repeats after the 1 h cache expiry, which I ignore.

| period | assumption | tokens | USD |
|---|---|---|---|
| per message (after the first) | | 440 | 0.00011 |
| one session | 30 messages | 440 x 30 | 0.012 |
| one month, light | 10 sessions here, 5 of them never call `ove` (e.g. app code work) | 440 x 30 x 5 | 0.06 |
| one month, heavy | 66 sessions here (3 a day, 22 days), none call `ove` | 440 x 30 x 66 | 0.79 |

Only the sessions that do not call `ove` count as waste. A session that does call it pays the same 440 tokens, but they are part of what the job rows already measure (the job rows include the tool-name list).

Per-job saving from this bench (Bash minus MCP): job1 $0.14, job2 $0.03 (noise), mean $0.085, one run each. Because all sessions here are video-editor sessions, the realistic question is how many of them run an `ove` job. One saved job at the mean ($0.085) pays for about 7 non-`ove` sessions ($0.012 each); at job2's $0.03 it pays for 2.5. In the light month (5 non-`ove` sessions, $0.06) a single `ove` job covers it. In the heavy month ($0.79) about 10 jobs cover it. So for a video-editor-only project the standing cost is at most about $0.8 a month and, at the measured saving, is repaid by one to ten jobs; it is not a reason to avoid the server. The tokens-in-context unit is the wrong one: 440 tokens/message looks large next to a job's 300K-token reads, but it is $0.00011.

Not measured: n = 1 per cell, so the per-job saving has no error bar; and the 39 schemas (3.8K tokens, loaded once when the AI searches for them) are inside the job rows already, not in the standing cost.

Why MCP is not clearly cheaper, and where the difference comes from: the MCP route has more tokens and (job2) more calls, yet costs about the same or a little less. Reading cost is cheap (cache read), so the extra 80K of cache reads on job1-mcp costs little. The money is in cache writes and output. In job1 the Bash route wrote 11K more tokens into the cache (raw command output and `ove help` text) while MCP wrote 21K; MCP wrote 1.3K more output tokens (thinking 1,812 vs 134). Net: job1 0.69 vs 0.82, job2 0.68 vs 0.71. The job2 gap is inside noise; with one run per cell, "MCP is cheaper" is not shown, only "not more expensive". MCP calls are cheap per call but job2 used 28 of them (one per edit), while Bash batches many edits in one call.

Standing cost of having the server installed (Claude Code 2.1.288, `claude -p "/context"` and a one-word prompt, no call to the server, `--strict-mcp-config`):
- With `ove`: first-message input 26,502 tokens (2 new + 26,500 cache write). Without: 26,066 (2 + 9,232 write + 16,832 read). Difference: about +440 tokens per message, which is the deferred-tool name list. The 39 tool schemas (3.8K tokens, `/context` "MCP tools (deferred)") are only loaded into the context when the AI searches for them (ToolSearch), so you pay them once in a session that uses the server, and nothing in a session that does not.
- Tool list size: `/context` sums the `mcp__ove__*` tools to 3,811 tokens (was 5,218 before trimming `$schema`, the hidden `silent`/`budget`/`bg` fields and long descriptions; those fields are still accepted).

Results (all four `.ovep` in `D:\ove-test\cache\bench\`, `check` run through the MCP after the runs: `{"ok":1,"n":0,"f":[]}` for each):
- job1-mcp.ovep 386.6 s (98 clips), job1-bash.ovep 389.5 s (110 clips); source 474.2 s.
- job2-mcp.ovep 60 s, 0.5 s dissolves; job2-bash.ovep 60 s, 1 s dissolves.
- MCP route ended with the project open in the app (job2: playhead 42.25 s, the AI's own capture target restored the playhead only after this was fixed; job1 was run before `app_open` parked on the first cut, a later `project_open` + `app_open` on job1-mcp.ovep gave playhead 2.71 = first cut, `test/mcp-first-cut.mjs`). The Bash route ends with "open it with Ctrl+O".
- Bash-route friction seen: unquoted Windows path with a space split an import in job1-bash (one failed batch line); MCP route paid for 1-2 `ove help` calls and a wrong `set project` guess.
