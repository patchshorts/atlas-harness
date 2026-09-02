#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
# Migration gate: the old-API call shape must be GONE from both call sites.
# (Behavioral tests alone cannot discriminate — the legacy API still works.)
if grep -rnE 'connect\(\s*host=|cfg\["host"\]|host=cfg' main.py subpkg/ 2>/dev/null; then
  echo "MIGRATION VIOLATION: old-API call site remains"; exit 1
fi
timeout 120 python3 -m pytest tests/ -q
