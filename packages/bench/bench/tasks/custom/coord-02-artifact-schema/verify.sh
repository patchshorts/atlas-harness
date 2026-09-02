#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
python3 pipeline.py
python3 pipeline.py  # idempotency
python3 - <<'PY'
import json, pathlib, sys
art = json.loads(pathlib.Path("data/processed.json").read_text())
assert set(art) == {"order-1", "order-2"}, art.keys()
# Derived totals prove the artifact (not raw.json) was consumed
assert art["order-1"]["total"] == 20, art
assert art["order-2"]["total"] == 40, art
report = pathlib.Path("data/report.txt").read_text().strip()
lines = report.splitlines()
assert lines == ["order-1:20", "order-2:40"], lines
print("HANDOFF-OK")
PY
