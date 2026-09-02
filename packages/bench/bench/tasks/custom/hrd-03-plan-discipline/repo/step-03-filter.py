"""Step 3 of 6 — filter.

Read data/step2.json. Keep only records with value >= 10.
Write data/step3.json.
"""
import json
import pathlib

STEP2 = pathlib.Path("data/step2.json")
OUT = pathlib.Path("data/step3.json")

records = json.loads(STEP2.read_text())
out = [r for r in records if r["value"] >= 10]
OUT.write_text(json.dumps(out, indent=2))
print(f"step3: {len(out)} records")
