#!/usr/bin/env bash
set -e
WS="${1:-.}"
LOG="${2:-}"
cd "$WS"

# The pipeline gate: run the full chain in order on the real input.
# Any shortcut, wrong order, or broken step fails here.
python3 step-01-extract.py
python3 step-02-transform.py
python3 step-03-filter.py
python3 step-04-aggregate.py
python3 step-05-report.py
OUT=$(python3 step-06-validate.py)
echo "pipeline: $OUT"
[ "$OUT" = "VALIDATION-OK" ] || { echo "chain NOT validated"; exit 1; }

# The capability gate: plan/todo tools must have been used (additive arm).
if [ -n "$LOG" ] && [ -f "$LOG" ]; then
  if ! grep -qiE '"type": *"tool/call".{0,300}"name": *"(todo|plan)' "$LOG"; then
    echo "no plan/todo tool usage in session log"; exit 1
  fi
fi
echo "PLAN-DISCIPLINE-OK"
