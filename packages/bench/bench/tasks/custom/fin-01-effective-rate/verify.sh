#!/usr/bin/env bash
# fin-01-effective-rate verifier.
#
# Deterministic green (no LLM judgment): runs the completed model.py, then
# checks `dist/summary.md` for the EXACT converted totals, the per-region
# breakout, and the rounding invariants. It also mutates an EARLY-period rate
# in a fixture copy and requires the output to change — proving the model
# actually consults `effective_from` (a latest-rate model is unaffected by
# mutating an early date, and a correct model is).
#
# Red (exit non-zero):
#   - using the latest rate for every row (naive: grand off by $10,376.19),
#   - rounding at the total instead of per line (last-cent drift),
#   - re-aggregating raw rows regionally (regions no longer sum to grand).
set -u
WS="${1:-.}"
cd "$WS" || { echo "verifier: cannot cd to sandbox"; exit 2; }

MODEL="model.py"
if [ ! -f "$MODEL" ]; then echo "verifier: model.py missing"; exit 2; fi

# --- regenerate the summary (the model writes dist/summary.md) ---
python3 "$MODEL" || { echo "verifier: model.py exited non-zero"; exit 2; }
OUT="dist/summary.md"
if [ ! -f "$OUT" ]; then echo "verifier: dist/summary.md missing after run"; exit 1; fi

RESULT=$( python3 - "$OUT" <<'PY'
import re, sys
out_path = sys.argv[1]
text = open(out_path, encoding="utf-8").read()

EXPECT_CUR = {"USD": "192220.00", "EUR": "360816.24", "GBP": "163336.57", "JPY": "2134.68"}
EXPECT_REG = {"NA": "154006.42", "EU": "227179.99", "APAC": "41891.18", "LATAM": "295429.90"}
EXPECT_GRAND = "718507.49"

# isolate the two tables: currency rows come before "## Regional breakout",
# region rows after it (avoids 3-letter currency codes colliding with regions)
before, _, after = text.partition("## Regional breakout")

# parse currency subtotal table from the top section:  | C | X.XX |
cur = {}
for m in re.finditer(r"^\|\s*([A-Z]{3})\s*\|\s*([0-9]+\.\d{2})\s*\|", before, re.M):
    cur[m.group(1)] = m.group(2)
# parse region table from the breakout section (NA/EU 2-letter; APAC/LATAM 4-5)
reg = {}
for m in re.finditer(r"^\|\s*([A-Z]{2,5})\s*\|\s*([0-9]+\.\d{2})\s*\|", after, re.M):
    reg[m.group(1)] = m.group(2)
# grand total line:  **Grand total:** $X.XX
gm = re.search(r"\*\*Grand total:\*\*\s*\$([0-9]+\.\d{2})", text)
grand = gm.group(1) if gm else None

def dec(s): return float(s) if s else None

fails = []
for c, exp in EXPECT_CUR.items():
    if cur.get(c) != exp:
        fails.append(f"currency {c}: got {cur.get(c)!r} want {exp!r}")
for r_, exp in EXPECT_REG.items():
    if reg.get(r_) != exp:
        fails.append(f"region {r_}: got {reg.get(r_)!r} want {exp!r}")
if grand != EXPECT_GRAND:
    fails.append(f"grand total: got {grand!r} want {EXPECT_GRAND!r}")

# invariants: per-currency and per-region subtotals both sum exactly to grand
if cur and grand:
    sc = sum(dec(v) for v in cur.values())
    if abs(sc - dec(grand)) > 1e-6:
        fails.append(f"per-currency subtotals sum {sc:.2f} != grand {grand}")
if reg and grand:
    sr = sum(dec(v) for v in reg.values())
    if abs(sr - dec(grand)) > 1e-6:
        fails.append(f"per-region subtotals sum {sr:.2f} != grand {grand} (region re-aggregation from raw rows)")

print("CURR=" + ",".join(f"{c}={cur.get(c)}" for c in sorted(EXPECT_CUR)))
print("REG=" + ",".join(f"{r_}={reg.get(r_)}" for r_ in sorted(EXPECT_REG)))
print("GRAND=" + str(grand))
for f in fails:
    print("FAIL:", f)
sys.exit(1 if fails else 0)
PY
)
RC=$?
echo "$RESULT"
if [ $RC -ne 0 ]; then exit 1; fi

# --- effective_from consultation: mutate an EARLY-period rate, output must change ---
MUT_OUT=$( python3 - "$WS" <<'PY'
import csv, os, subprocess, sys
ws = sys.argv[1]
# build a mutated rates.csv: change the EARLIEST effective EUR rate 0.9200 -> 0.9000
src = os.path.join(ws, "rates.csv")
mut = os.path.join(ws, "dist", "rates.mut.csv")
rows = []
with open(src, newline="") as f:
    for r in csv.DictReader(f):
        r = dict(r)
        if r["currency"] == "EUR" and r["effective_from"] == "2026-01-01":
            r["rate"] = "0.9000"
        rows.append(r)
with open(mut, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["currency", "rate", "effective_from"])
    w.writeheader()
    w.writerows(rows)
# re-run the model on the mutated rates to a scratch output
scratch = os.path.join(ws, "dist", "summary.mut.md")
tx = os.path.join(ws, "transactions.csv")
r = subprocess.run([sys.executable, os.path.join(ws, "model.py"), tx, mut, scratch],
                   capture_output=True, text=True)
if r.returncode != 0:
    print("MUTATE-RUN-FAIL"); sys.exit(2)
import re
t = open(scratch, encoding="utf-8").read()
gm = re.search(r"\*\*Grand total:\*\*\s*\$([0-9]+\.\d{2})", t)
print("MUTATED_GRAND=" + (gm.group(1) if gm else "none"))
PY
)
echo "$MUT_OUT"
MG=$(echo "$MUT_OUT" | sed -n 's/^MUTATED_GRAND=//p')
if [ "$MG" = "718507.49" ] || [ -z "$MG" ]; then
  echo "FAIL: mutating an early-period rate did not change the output (effective_from not consulted)"
  exit 1
fi

# clean mutation scratch artifacts
rm -f dist/rates.mut.csv dist/summary.mut.md dist/.gitkeep

echo "fin-01-effective-rate OK"
exit 0
