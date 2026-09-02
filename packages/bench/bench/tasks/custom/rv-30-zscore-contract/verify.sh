#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
timeout 120 python3 -m pytest tests/ -q
python3 - <<'PY'
import os, sys
sys.path.insert(0, os.getcwd())
from zscore import zscore
assert zscore([7]) == [None], "CONTRACT FAIL: length-1 sample must return [None]"
try:
    zscore([])
except ValueError:
    pass
else:
    raise SystemExit("CONTRACT FAIL: expected ValueError on empty sample")
print("CONTRACT OK")
PY