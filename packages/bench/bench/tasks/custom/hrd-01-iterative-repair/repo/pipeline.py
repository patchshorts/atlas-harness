"""Pipeline processor: ingest, normalize, filter, aggregate, format.

The pipeline has five stages. Each stage is a pure function operating on a
list of record dicts. The pipeline is correct ONLY when all five stages
agree on one invariant: every record that enters the pipeline must keep its
`id` field untouched through every stage, and every record must survive to
the output unless it fails the FILTER stage.

Stage contract (binding):
- ingest(data): parse raw lines into records {id, value, status}. Skip
  malformed lines WITHOUT raising (log to WARNINGS list).
- normalize(records): lowercase `status`, strip whitespace from `value`,
  drop records with empty value.
- filter(records): keep only status == "active".
- aggregate(records): sum values grouped by status; return dict
  status -> total (floats, exact two-decimal arithmetic). A non-numeric
  value is treated as 0.0 — it must never crash the pipeline.
- format(result): produce "status:total" lines sorted by status, each
  total formatted with EXACTLY two decimals.

There are SIX bugs seeded in this file. All tests in tests/ must pass.
The tests are interdependent: fixing one bug may cause a different test
to fail until the related bug is also fixed. Run the test suite, read the
failures, fix, and re-run until green. Do not modify tests/.
"""
import re

WARNINGS = []


def ingest(data):
    records = []
    for line in data.splitlines():
        m = re.match(r"^(\w+)\|([^|]*)\|(active|inactive|pending)$", line.strip())
        if not m:
            WARNINGS.append(line)
            continue
        records.append({"id": m.group(1), "value": m.group(2), "status": m.group(3)})
    return records


def normalize(records):
    out = []
    for r in records:
        if r["value"].strip() == "":
            continue
        out.append({"id": r["id"], "value": r["value"], "status": r["status"].lower()})
    return out


def filter(records):
    return [r for r in records if r["status"] != "inactive"]


def aggregate(records):
    totals = {}
    for r in records:
        v = float(r["value"])
        totals[r["status"]] = totals.get(r["status"], 0.0) + v
    return totals


def format(result):
    return "\n".join(f"{k}:{v}" for k, v in sorted(result.items()))
