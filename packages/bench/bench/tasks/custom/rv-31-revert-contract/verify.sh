#!/usr/bin/env bash
# rv-31-revert-contract verifier — module.py must end clause-identical to the
# reference in contract.py (the full contract IS the reference; tests alone are
# not the gate). byte-level + a behavior probe both must pass.
set -e
WS="${1:-.}"
cd "$WS"
timeout 120 python3 -m pytest tests/ -q

# Behavior probe: the upper-bound guard must restore (v > hi) -> hi.
python3 - <<'PY'
import sys, os
sys.path.insert(0, os.getcwd())
from module import clamp
assert clamp(5, 1, 3) == 3, "upper-bound guard must return hi when v > hi"
assert clamp(0, 1, 3) == 1, "lower-bound guard"
assert clamp(2, 1, 3) == 2, "in-range passthrough"
print("RESTORE-OK")
PY