#!/bin/bash
# Benchmark: one run each of a job through the MCP and through `ove` via Bash, both in headless Claude Code. Usage: test/mcp-bench.sh <mcp|bash> <job1|job2>
# Needs: the app running on Windows (OVE_INACTIVE=1, no CDP), repo copy at D:\ove-test with node_modules (npm.cmd install).
route=$1; job=$2; out=/mnt/d/ove-test/cache/bench; mkdir -p "$out"
media='D:\OBS Videos\2023-08-16 23-55-20.mp4'
case $job in
  job1) ask="Remove the dead air from $media and show me." ;;
  job2) ask="Make a 60 s reel of the loudest moments of $media with dissolves between them, and show me." ;;
esac
cd "$(dirname "$0")/.."
if [ "$route" = mcp ]; then
  cat > "$out/mcp.json" <<J
{"mcpServers":{"ove":{"command":"node.exe","args":["D:\\\\ove-test\\\\cli\\\\mcp.js"]}}}
J
  prompt="$ask Use the ove MCP tools only. Save the project as D:\\ove-test\\cache\\bench\\$job-mcp.ovep. Do not export."
  args=(--mcp-config "$out/mcp.json" --strict-mcp-config --allowedTools "mcp__ove" --disallowedTools "Bash Edit Write Read Glob Grep Agent")
else
  prompt="$ask Use the ove CLI through Bash (node cli/ove.js help). Save the project as /mnt/d/ove-test/cache/bench/$job-bash.ovep. Do not export; tell me to open it in the app."
  args=(--strict-mcp-config --allowedTools "Bash Read" --disallowedTools "Edit Write Glob Grep Agent")
fi
claude -p "$prompt" --output-format stream-json --verbose --no-session-persistence --max-budget-usd 6 --permission-mode dontAsk "${args[@]}" > "$out/$job-$route.jsonl" 2> "$out/$job-$route.err"
python3 - "$out/$job-$route.jsonl" <<'P'
import json,sys
calls=0; turns=set(); res=None
for l in open(sys.argv[1]):
    try: e=json.loads(l)
    except: continue
    if e.get('type')=='assistant':
        m=e['message']; turns.add(m['id'])
        calls+=sum(1 for b in m['content'] if b.get('type')=='tool_use' and b['name']!='ToolSearch')
    if e.get('type')=='result': res=e
u=res['usage']  # the result line has the true totals; per-message usage in the stream holds partial output counts
print(json.dumps({'tool_calls':calls,'api_turns':len(turns),'input_new':u['input_tokens'],'cache_write':u['cache_creation_input_tokens'],'cache_read':u['cache_read_input_tokens'],'output':u['output_tokens'],'cost_usd':res.get('total_cost_usd'),'result':res.get('result','')[:600]},indent=1))
P
