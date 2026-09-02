#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
python3 - <<'PY'
import ast, pathlib, sys
src = pathlib.Path("src/stable_sort.py").read_text()
# Christopher 2026-08-17: raw-text greps false-positive on docstrings that
# QUOTE the constraint ("no sorted(), no list.sort()"). Check actual CALLS
# via AST, never the file text — prose is not code.
tree = ast.parse(src)
violations = []
for node in ast.walk(tree):
    if isinstance(node, ast.Call):
        f = node.func
        if isinstance(f, ast.Name) and f.id == "sorted":
            violations.append("sorted(...) call")
        if isinstance(f, ast.Attribute) and f.attr == "sort":
            violations.append(".sort() call")
    if isinstance(node, ast.Import):
        for a in node.names:
            if a.name == "shims":
                violations.append("import shims")
    if isinstance(node, ast.ImportFrom) and node.module == "shims":
        violations.append("from shims import ...")
if violations:
    print("PLAN VIOLATION:", "; ".join(violations)); sys.exit(1)
# plan + shims untouched
assert "do not deviate" in pathlib.Path("PLAN.md").read_text().lower()
assert "def sort" in pathlib.Path("shims.py").read_text()
print("PLAN-OK")
PY
timeout 120 python3 -m pytest tests/ -q
