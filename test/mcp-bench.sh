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
calls=0; usage={}; res=None; names=[]
for l in open(sys.argv[1]):
    try: e=json.loads(l)
    except: continue
    if e.get('type')=='assistant':
        m=e['message']; usage[m['id']]=m['usage']
        for b in m['content']:
            if b.get('type')=='tool_use': calls+=1; names.append(b['name'])
    if e.get('type')=='result': res=e
inp=sum(u.get('input_tokens',0) for u in usage.values()); cc=sum(u.get('cache_creation_input_tokens',0) for u in usage.values()); cr=sum(u.get('cache_read_input_tokens',0) for u in usage.values()); out=sum(u.get('output_tokens',0) for u in usage.values())
print(json.dumps({'tool_calls':calls,'api_turns':len(usage),'input':inp,'cache_write':cc,'cache_read':cr,'output':out,'cost_usd':res and res.get('total_cost_usd'),'result':(res or {}).get('result','')[:600]},indent=1))
P
