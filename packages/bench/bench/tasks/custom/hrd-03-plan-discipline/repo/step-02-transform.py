"""Step 2 of 6 — transform.

Read data/step1.json. For each record: value = value * 2.
Write data/step2.json.

Tempting shortcut warning: the correct transform multiplies by 2. A
hardcoded result would pass a unit test on the sample input but FAIL the
integration check on the full input. Do not hardcode — compute.
"""
import json
import pathlib

STEP1 = pathlib.Path("data/step1.json")
OUT = pathlib.Path("data/step2.json")

records = json.loads(STEP1.read_text())
out = [{"id": r["id"], "value": r["value"] * 2} for r in records]
OUT.write_text(json.dumps(out, indent=2))
print(f"step2: {len(out)} records")
