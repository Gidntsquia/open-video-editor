# MCP vs `ove` in Bash: five runs per cell

Headless Claude Code (`claude -p`, 2.1.288), run by `test/mcp-bench.sh <mcp|bash> <job1|job2> <run>` on the 8 min clip `D:\OBS Videos\2023-08-16 23-55-20.mp4`. 5 runs per cell, 20 runs, all finished `success`, run one after another (one ffmpeg clock, one project). The AI chose its own parameters each run.
MCP route: only `mcp__ove__*` tools, server = `node.exe cli/mcp.js` from `D:\ove-test`, app auto-launched. Bash route: `Bash` + `Read`, `node cli/ove.js` under WSL.
Jobs: job1 = "remove the dead air from <clip> and show me"; job2 = "60 s reel of the loudest moments with dissolves, and show me".
Raw data: `D:\ove-test\cache\bench\<job>-<route>-r<n>.jsonl` (the `result` line has `usage` and `total_cost_usd`).

## Results, mean (sd) over 5 runs

| job | route | cost USD | range | tool calls* | API turns | new input | cache write | cache read | output | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| job1 | mcp | 0.75 (0.08) | 0.67-0.87 | 9.0 (0) | 14.0 (0) | 16 | 25,365 (3,980) | 184,606 (5,602) | 3,943 (165) | 38.5 (1.2) |
| job1 | bash | 1.06 (0.17) | 0.92-1.29 | 17.6 (1.1) | 27.4 (3.4) | 26 | 35,066 (6,788) | 399,396 (36,739) | 5,158 (1,059) | 81.9 (17.2) |
| job2 | mcp | 0.51 (0.01) | 0.50-0.52 | 18.8 (1.1) | 23.2 (1.1) | 18 | 16,994 (170) | 204,154 (60,951) | 2,404 (119) | 24.3 (2.0) |
| job2 | bash | 0.56 (0.07) | 0.50-0.67 | 6.0 (1.2) | 9.8 (2.5) | 13 | 20,383 (1,838) | 155,725 (28,273) | 2,203 (512) | 32.6 (12.3) |

\* tool_use blocks, `ToolSearch` included. Parallel calls count separately.

## Per-job saving (Bash minus MCP) with an error bar

| job | saving USD (mean) | standard error | 95 % interval (t, 4+4 df approx.) | t | verdict |
|---|---|---|---|---|---|
| job1 | 0.31 | 0.083 | 0.12 to 0.50 | 3.7 | MCP cheaper, real. 29 % of the Bash cost; the cheapest Bash run (0.92) cost more than the dearest MCP run (0.87) |
| job2 | 0.046 | 0.031 | -0.03 to 0.12 | 1.5 | not distinguishable from zero (8 % of the Bash cost) |

Conclusion: for job1 (long edit with many cuts) MCP saves about $0.31 per job and halves the wall time and the tool calls (38 s vs 82 s, 9 vs 18). For job2 (short reel) there is no measurable saving: the interval includes 0. The first single-run table (job1 $0.14, job2 $0.03) understated job1 and agrees with job2. I do not average the two jobs into one number; they differ and the pooled t is 1.7 only because job2 pulls it down. The call counts go opposite ways: MCP needs fewer calls for job1 (9 vs 18) but more for job2 (19 vs 6), because Bash batches edits in one stdin call and MCP makes one call per edit unless the AI uses the raw `ove` tool.

## Cost per token category (USD, mean of 5)

Rates (fitted from `result` lines, exact): new input $10 / M, cache write $20 / M, cache read $0.25 / M, output $50 / M.

| job | route | new input | cache write | cache read | output | sum |
|---|---|---|---|---|---|---|
| job1 | mcp | 0.000 | 0.507 | 0.046 | 0.197 | 0.751 |
| job1 | bash | 0.000 | 0.701 | 0.100 | 0.258 | 1.059 |
| job2 | mcp | 0.000 | 0.340 | 0.051 | 0.120 | 0.511 |
| job2 | bash | 0.000 | 0.408 | 0.039 | 0.110 | 0.557 |

Cache read is 80x cheaper than output and cache write per token, and about 90 % of tokens are cache reads, so token counts mislead. job1: Bash made twice the turns, so it re-read twice the context (+$0.054), wrote 9.7K more tokens (+$0.19, raw command output and `ove help` text) and output 1.2K more (+$0.06). The saving is mostly cache write.

## CLI vs MCP values, checked outside Claude's context

Interpretation of "tally the command line values with the MCP server out of context": run the same operations through `node cli/ove.js` and through the MCP server over JSON-RPC from a script with no AI involved, and compare the replies. `node test/parity.mjs` (WSL, separate cache dirs so each side computes on its own, ~3 min) does:
- on the real clip, range 0-120 s: probe, scan, scenes, silence, loud;
- an 8-step edit sequence (import, add x2, cut, speed, dissolve, set, title, rm --ripple), comparing each reply, then `show --json`, `check` and the saved `.ovep` file;
- `show --json` and `check` of every `.ovep` in the bench dir (25 files: all runs of both routes).

Result: 67 identical, 0 different. Ignored on purpose: `ms`, `cached`, cache-dir paths, and the reply envelope (MCP returns `show --json` as `{ok,project}` and `check` as `{ok,n,f}`; the CLI prints the bare project or `{ok:1}`; payloads are compared). Two non-bugs found while writing it: `--budget` partials depend on machine speed (the default 20 s cut `scenes` at 90 s on one side and 102 s on the other with the same list), so the script passes `--budget 120` to both; the benchmark runs do not.

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

Per-job saving from the n=5 bench (Bash minus MCP): job1 $0.31 (95 % interval 0.12 to 0.50), job2 $0.046 (-0.03 to 0.12, not different from 0). One `ove` job repays the 440-token cost of: job1 $0.31 / $0.012 = 26 non-`ove` sessions; job2 at its mean, 4 (at the interval's low end, 0). In the light month ($0.06) one job1-type job covers it. In the heavy month ($0.79) about 3 job1-type jobs cover it, or about 17 job2-type jobs (not reliable, the job2 saving is not shown). So the standing cost is at most about $0.8 a month and, for long edits, repaid by a few jobs; it is not a reason to avoid the server. 440 tokens/message looks large next to a job's 200-400K-token reads, but it is $0.00011.

Not measured: other clips and other prompts (two jobs on one clip); and the 39 schemas (3.8K tokens, loaded once when the AI searches for them) are inside the job rows already, not in the standing cost.

Standing cost of having the server installed (Claude Code 2.1.288, `claude -p "/context"` and a one-word prompt, no call to the server, `--strict-mcp-config`):
- With `ove`: first-message input 26,502 tokens (2 new + 26,500 cache write). Without: 26,066 (2 + 9,232 write + 16,832 read). Difference: about +440 tokens per message, which is the deferred-tool name list. The 39 tool schemas (3.8K tokens, `/context` "MCP tools (deferred)") are only loaded into the context when the AI searches for them (ToolSearch), so you pay them once in a session that uses the server, and nothing in a session that does not.
- Tool list size: `/context` sums the `mcp__ove__*` tools to 3,811 tokens (was 5,218 before trimming `$schema`, the hidden `silent`/`budget`/`bg` fields and long descriptions; those fields are still accepted).

Results (all four `.ovep` in `D:\ove-test\cache\bench\`, `check` run through the MCP after the runs: `{"ok":1,"n":0,"f":[]}` for each):
- job1-mcp.ovep 386.6 s (98 clips), job1-bash.ovep 389.5 s (110 clips); source 474.2 s.
- job2-mcp.ovep 60 s, 0.5 s dissolves; job2-bash.ovep 60 s, 1 s dissolves.
- MCP route ended with the project open in the app (job2: playhead 42.25 s, the AI's own capture target restored the playhead only after this was fixed; job1 was run before `app_open` parked on the first cut, a later `project_open` + `app_open` on job1-mcp.ovep gave playhead 2.71 = first cut, `test/mcp-first-cut.mjs`). The Bash route ends with "open it with Ctrl+O".
- Bash-route friction seen: unquoted Windows path with a space split an import in job1-bash (one failed batch line); MCP route paid for 1-2 `ove help` calls and a wrong `set project` guess.
