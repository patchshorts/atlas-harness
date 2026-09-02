#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
timeout 120 python3 -m pytest tests/ -q
python3 - <<'PY'
import os, sys
sys.path.insert(0, os.getcwd())
from parser import parse
for bad in (",", ",42", "   ,   "):
    try:
        parse(bad)
    except ValueError:
        pass
    else:
        raise SystemExit("CONTRACT FAIL: expected ValueError on blank field")
print("CONTRACT OK")
PY