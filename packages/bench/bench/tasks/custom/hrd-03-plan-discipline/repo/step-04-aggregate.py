"""Step 4 of 6 — aggregate.

Read data/step3.json. Group by id's first letter (a-z, case-insensitive).
For each group: sum the values. Write data/step4.json as
{"a": 12.5, "b": ...} sorted by key.
"""
import json
import pathlib

STEP3 = pathlib.Path("data/step3.json")
OUT = pathlib.Path("data/step4.json")

records = json.loads(STEP3.read_text())
totals = {}
for r in records:
    key = r["id"][0].lower()
    totals[key] = totals.get(key, 0.0) + r["value"]
OUT.write_text(json.dumps(dict(sorted(totals.items())), indent=2))
print(f"step4: {len(totals)} groups")
