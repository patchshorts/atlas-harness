#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
python3 pipeline.py
python3 pipeline.py  # idempotency
python3 - <<'PY'
import json, pathlib, sys
norm = pathlib.Path("data/normalized.csv").read_text()
rows = [l for l in norm.strip().splitlines()[1:] if l]
assert len(rows) == 5, rows
summary = json.loads(pathlib.Path("data/summary.json").read_text())
assert summary == {"A1": 25, "B2": 25, "C3": 5}, summary
print("HANDOFF-OK")
PY
