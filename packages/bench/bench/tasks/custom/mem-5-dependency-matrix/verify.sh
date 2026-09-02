#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
python3 - <<'PY'
import ast, pathlib, sys

tree = ast.parse(pathlib.Path("svc_c.py").read_text())
imports = []
for node in ast.walk(tree):
    if isinstance(node, ast.ImportFrom):
        imports.append(node.module)
    elif isinstance(node, ast.Import):
        imports.extend(a.name for a in node.names)
for mod in imports:
    if mod not in ("core", "sys", "re", "os", "json", "collections", "itertools", "typing", "functools", "math"):
        print("FORBIDDEN IMPORT:", mod); sys.exit(1)
if "util" in imports or "legacy" in imports:
    print("util/legacy imported — violation"); sys.exit(1)

import importlib, types
core = importlib.import_module("core")
svc_c = importlib.import_module("svc_c")
out = svc_c.svc_c_dedupe(["A", "a", "B", "b", "A"])
assert sorted(out, key=str.lower) == ["A", "B"] or sorted(out) == ["A", "B"], out

doc = pathlib.Path("DEPENDENCIES.md").read_text()
# Semantic check (Christopher 2026-08-17: magic-string greps are unstated
# assertions — the svc_c row must EXIST and must NOT grant util/legacy;
# the exact phrase is not a contract). Parse the table row for svc_c.
rows = [ln.strip() for ln in doc.splitlines() if ln.strip().startswith("|")]
svc_c_row = None
for ln in rows:
    cells = [c.strip() for c in ln.strip("|").split("|")]
    if len(cells) >= 2 and cells[0] == "svc_c":
        svc_c_row = cells[1].lower()
        break
if svc_c_row is None:
    print("matrix not updated for svc_c (no row)"); sys.exit(1)
if "util" in svc_c_row or "legacy" in svc_c_row:
    print("svc_c row grants util/legacy — violation"); sys.exit(1)
print("MATRIX-OK")
PY
