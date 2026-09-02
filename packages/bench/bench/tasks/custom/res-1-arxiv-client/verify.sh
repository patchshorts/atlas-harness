#!/usr/bin/env bash
set -e
WS="${1:-.}"
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$WS/fixtures"
cp "$DIR/fixtures/full_sample.xml" "$WS/fixtures/full_sample.xml"
cp "$DIR/check_arxiv.py" "$WS/check_arxiv.py"
cd "$WS"
python3 check_arxiv.py
