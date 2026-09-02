#!/usr/bin/env bash
# the cost-thesis pass — trivial-turn bench task verifier.
#
# The cost-thesis data point: a trivial greeting under xhigh must cost near
# minimal token-in. This verifier gates the BEHAVIORAL side deterministically
# from the session log (no LLM judgment):
#   1. the model produced an assistant/message reply,
#   2. that reply is the expected SHORT trivial greeting (not a task-completion
#      dump — proving no heavy context wall was needed to answer it),
#   3. the model called ZERO tools (a trivial turn needs no tool use).
#
# The token-in/cost number itself is measured separately (T11 measured in the
# bench run's cost sidecar); this verifies the response contract only.
set -u
WS="${1:-.}"
LOG="${2:-}"
cd "$WS" || { echo "verifier: cannot cd to sandbox"; exit 2; }

if [ -z "$LOG" ] || [ ! -f "$LOG" ]; then
  echo "verifier: no session log (arg 2) — cannot verify trivial turn"
  exit 2
fi

python3 - "$LOG" <<'PY'
import json, sys, re

log_path = sys.argv[1]
events = []
with open(log_path) as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue

if not events:
    print("verifier: empty session log"); sys.exit(2)

def text_of(data):
    out = []
    c = data.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        for b in c:
            if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str):
                out.append(b["text"])
    if isinstance(data.get("text"), str):
        out.append(data["text"])
    return "\n".join(out)

tool_calls = 0
assistant_texts = []
for ev in events:
    t = ev.get("type", "")
    data = ev.get("data") or ev
    if t == "tool/call":
        tool_calls += 1
    if t == "assistant/message":
        txt = text_of(data)
        if txt.strip():
            assistant_texts.append(txt)

# 1. A reply was produced.
if not assistant_texts:
    print("verifier: no assistant/message reply in session log"); sys.exit(1)

# 2. The final reply is the expected short trivial greeting.
final = assistant_texts[-1]
final_norm = re.sub(r"\s+", " ", final).strip().lower()
expected_norm = "hello, what can I do for you?"
if expected_norm not in final_norm and not re.search(r"what can i do for you", final_norm):
    print(f"verifier: reply not the trivial greeting: {final[:120]!r}"); sys.exit(1)
if len(final.split()) > 40:
    print(f"verifier: reply too long for a trivial turn ({len(final.split())} words)"); sys.exit(1)

# 3. Zero tool calls — a trivial turn needs no tools.
if tool_calls != 0:
    print(f"verifier: trivial turn made {tool_calls} tool call(s)"); sys.exit(1)

print(f"verifier: trivial-turn OK ({len(final.split())} words, {tool_calls} tool calls)")
PY
