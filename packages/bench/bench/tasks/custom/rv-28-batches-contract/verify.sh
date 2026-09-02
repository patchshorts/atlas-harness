#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
timeout 120 python3 -m pytest tests/ -q
python3 - <<'PY'
import os, sys
sys.path.insert(0, os.getcwd())
from batches import batches
try:
    batches(5, 0)
except ValueError:
    pass
else:
    raise SystemExit("CONTRACT FAIL: expected ValueError when size <= 0")
print("CONTRACT OK")
PY