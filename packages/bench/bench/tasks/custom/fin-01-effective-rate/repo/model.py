#!/usr/bin/env python3
"""Multi-currency finance model (fin-01-effective-rate).

Converts a multi-currency transaction ledger to USD for the finance summary
in POLICY.md §3.

NOTE (agent): this is the PARTIALLY-BUILT starting point. The single-currency
tests under tests/ pass, but the multi-currency summary does NOT yet follow
POLICY.md §2–§4. Read POLICY.md in full and complete the implementation so it
produces the summary described in §3 (per-currency subtotals, grand total,
and the regional breakout) following the effective-date conversion and
per-line rounding rules.
"""
import csv
import os
import sys
from decimal import Decimal, ROUND_HALF_UP


def load_rates(path):
    """Return ({currency: latest_rate}, {currency: [(effective_from, rate)]})."""
    latest = {}
    history = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            cur, eff = r["currency"], r["effective_from"]
            rate = Decimal(r["rate"])
            history.setdefault(cur, []).append((eff, rate))
            latest[cur] = rate  # keeps the LAST row seen -> naive latest rate
    return latest, history


def load_transactions(path):
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            rows.append(
                {
                    "date": r["date"],
                    "region": r["region"],
                    "currency": r["currency"],
                    "amount": Decimal(r["amount"]),
                }
            )
    return rows


def convert(amount, rate, per_line=True):
    usd = amount / rate
    if per_line:
        return usd.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return usd


def rate_for_date(history, currency, date):
    """Return the rate effective on `date`.

    POLICY.md §2: the most recent rate whose effective_from is on or before
    the transaction date.

    TODO(agent): this currently returns the LATEST rate for the currency,
    which violates §2. Implement the effective-date lookup.
    """
    return history[currency][-1][1]


def summary(trans_path, rates_path, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    latest, history = load_rates(rates_path)
    txns = load_transactions(trans_path)

    gross = {}  # currency -> raw (unrounded) USD sum
    for t in txns:
        rate = latest[t["currency"]]           # naive: latest rate for every row
        usd = convert(t["amount"], rate, per_line=False)  # naive: round later
        gross[t["currency"]] = gross.get(t["currency"], Decimal("0")) + usd

    # Rounding applied only once at the subtotal (violates §3 per-line rule).
    per_cur = {
        c: v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        for c, v in gross.items()
    }
    grand = sum(per_cur.values())

    # Regional breakout currently a stub — see POLICY.md §4.
    regions = {"NA", "EU", "APAC", "LATAM"}

    with open(out_path, "w") as f:
        f.write("# Summary\n")
        f.write("| currency | total_usd |\n")
        f.write("|----------|-----------|\n")
        for c in ("USD", "EUR", "GBP", "JPY"):
            f.write(f"| {c} | {per_cur[c]:.2f} |\n")
        f.write(f"**Grand total:** ${grand:.2f}\n\n")
        f.write("## Regional breakout\n")
        f.write("| region | total_usd |\n")
        f.write("|--------|-----------|\n")
        for reg in sorted(regions):
            f.write(f"| {reg} | 0.00 |\n")
    return grand


if __name__ == "__main__":
    base = os.path.dirname(os.path.abspath(__file__))
    trans = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base, "transactions.csv")
    rates = sys.argv[2] if len(sys.argv) > 2 else os.path.join(base, "rates.csv")
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(base, "dist", "summary.md")
    summary(trans, rates, out)
