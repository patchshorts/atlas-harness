"""Two-subtask pipeline with an explicit handoff artifact.

Subtask A (normalize): read data/raw.csv, strip whitespace, uppercase codes,
dedupe identical (code, region, amount) rows, write data/normalized.csv.
Handoff artifact: data/normalized.csv (consumed ONLY by subtask B).
Subtask B (summarize): read data/normalized.csv, write data/summary.json
with per-code totals: {"A1": 25, "B2": 25, "C3": 5} (amounts summed).
Run end-to-end with `python3 pipeline.py` (must be idempotent).
"""
import json, csv, pathlib

def normalize():
    rows = []
    with open("data/raw.csv", newline="") as f:
        for r in csv.DictReader(f):
            rows.append({
                "code": r["code"].strip().upper(),
                "region": r["region"].strip().upper(),
                "amount": int(r["amount"]),
            })
    seen, out = set(), []
    for r in rows:
        key = (r["code"], r["region"], r["amount"])
        if key not in seen:
            seen.add(key); out.append(r)
    with open("data/normalized.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["code", "region", "amount"])
        w.writeheader(); w.writerows(out)
    return out

def summarize():
    # TODO: implement subtask B (reads data/normalized.csv, writes summary.json)
    raise NotImplementedError

if __name__ == "__main__":
    normalize()
    summarize()
