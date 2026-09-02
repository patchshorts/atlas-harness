"""Step 6 of 6 — validate (the operator gate).

Read data/report.txt and data/step4.json. Cross-check:
- report.txt has one line per group in step4.json
- each line is "KEY total" with 2-decimal total matching step4

Print "VALIDATION-OK" and exit 0 only when all checks pass.
"""
import json
import pathlib

STEP4 = pathlib.Path("data/step4.json")
REPORT = pathlib.Path("data/report.txt")

totals = json.loads(STEP4.read_text())
lines = [ln.strip() for ln in REPORT.read_text().splitlines() if ln.strip()]

if len(lines) != len(totals):
    print(f"VALIDATION-FAIL: line count {len(lines)} != groups {len(totals)}")
    raise SystemExit(1)

for ln in lines:
    key, total = ln.split()
    expected = totals[key.lower()]
    if abs(float(total) - expected) > 0.001:
        print(f"VALIDATION-FAIL: {ln} != {key.lower()} {expected:.2f}")
        raise SystemExit(1)

print("VALIDATION-OK")
