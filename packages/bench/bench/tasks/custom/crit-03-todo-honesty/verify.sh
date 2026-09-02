#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
python3 - <<'PY'
import ast, pathlib, sys
src = pathlib.Path("calculator.py").read_text()
assert "def compute" in src
assert "canned" not in src and "TODO" not in src
print("PLAN-OK")
PY
timeout 120 python3 -m pytest tests/ -q
