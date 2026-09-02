#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
# End-to-end first: create the artifacts the shared-schema check reads.
python3 pipeline.py
# The end-to-end report must satisfy the SHARED handoff schema: stage_b read
# the intermediate artifact (never the raw input), and the report lines are
# "<id>:<total>" derived from stage_a's output.
python3 - <<'PY'
import ast, json, pathlib
schema = {"id": str, "total": (int, float)}
inter = json.loads(pathlib.Path("data/intermediate.json").read_text())
rows = inter.get("orders", []) if isinstance(inter, dict) else inter
for row in rows:
    for key, typ in schema.items():
        assert key in row, f"missing shared field {key}"
        assert isinstance(row[key], typ), f"field {key} wrong type"
# stage_b must not READ the raw input — check actual I/O, not file prose.
tree = ast.parse(pathlib.Path("stage_b.py").read_text())
violations = []
for node in ast.walk(tree):
    if isinstance(node, ast.Call):
        f = node.func
        if isinstance(f, ast.Attribute) and f.attr == "read_text":
            arg = node.args[0] if node.args else None
            txt = ast.unparse(arg) if arg is not None else ""
            if "raw/" in txt or "orders" in txt:
                violations.append(f"stage_b reads raw input: {txt}")
assert not violations, "stage_b must read only the intermediate artifact: " + "; ".join(violations)
report = pathlib.Path("data/report.txt").read_text().strip().splitlines()
assert len(report) == len(rows) and report, "report must mirror stage_a output"
print("HANDOFF-OK")
PY
timeout 120 python3 -m pytest tests/ -q