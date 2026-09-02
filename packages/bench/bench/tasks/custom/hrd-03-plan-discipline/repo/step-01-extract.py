"""Step 1 of 6 — extract.

Read input/raw.txt. Every line is "id,value". Emit data/step1.json:
a JSON array of {"id": ..., "value": ...} (value as a NUMBER).
"""
import json
import pathlib

RAW = pathlib.Path("input/raw.txt")
OUT = pathlib.Path("data/step1.json")

records = []
for line in RAW.read_text().splitlines():
    if not line.strip():
        continue
    i, v = line.split(",")
    records.append({"id": i.strip(), "value": float(v.strip())})

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(records, indent=2))
print(f"step1: {len(records)} records")
