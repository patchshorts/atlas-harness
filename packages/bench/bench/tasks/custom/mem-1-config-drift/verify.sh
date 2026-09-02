#!/usr/bin/env bash
# Deterministic verifier: run the repo tests after the session.
set -e
WS="${1:-.}"
cd "$WS"
timeout 120 python3 -m pytest tests/ -q
