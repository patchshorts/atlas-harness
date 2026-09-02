#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
python3 -m pip install -q -r requirements.txt 2>/dev/null || true
python3 - <<'PY'
import pathlib, sys
src = pathlib.Path("legacy.py").read_text()
for pat in ("@validator", "class Config", "class_validators", "from pydantic import validator"):
    if pat in src:
        print("V1 PATTERN REMAINS:", pat); sys.exit(1)
print("V1-CLEAN")
PY
timeout 120 python3 -m pytest tests/ -q
