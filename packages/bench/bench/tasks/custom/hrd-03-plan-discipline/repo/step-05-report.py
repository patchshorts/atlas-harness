"""Step 5 of 6 — report.

Read data/step4.json. Produce data/report.txt — one line per group:
"KEY total" (uppercase key, total with 2 decimals).
"""
import json
import pathlib

STEP4 = pathlib.Path("data/step4.json")
OUT = pathlib.Path("data/report.txt")

totals = json.loads(STEP4.read_text())
lines = [f"{k.upper()} {v:.2f}" for k, v in totals.items()]
OUT.write_text("\n".join(lines) + "\n")
print(f"step5: {len(lines)} lines")
