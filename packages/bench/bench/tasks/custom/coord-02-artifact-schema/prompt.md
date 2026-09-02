Complete repo/ so all tests pass. Worker A (worker_a.py) writes
data/processed.json with keys: id, total (total = amount x 2 — the artifact
carries DERIVED data, not a copy of the input). Worker B (worker_b.py) must
READ that artifact (never the raw input) and write data/report.txt with one
"<id>:<total>" line per order. Run `python3 pipeline.py` end-to-end; it must
be idempotent (running twice yields the same files). Do not modify tests/.