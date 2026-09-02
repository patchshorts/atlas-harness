"""Existing tests for the finance model — cover only SINGLE-CURRENCY cases.

These pass with the current (partially-built) model. The multi-currency
summary rules in POLICY.md §2–§4 are intentionally NOT covered here.
"""
import os
import sys
import tempfile
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import model


def _rates(rows):
    """Write a rates.csv from (currency, rate, effective_from) tuples; return history."""
    td = tempfile.mkdtemp()
    with open(os.path.join(td, "rates.csv"), "w") as f:
        f.write("currency,rate,effective_from\n")
        for c, r, e in rows:
            f.write(f"{c},{r},{e}\n")
    _, hist = model.load_rates(os.path.join(td, "rates.csv"))
    return hist


def test_single_usd_converts_to_itself():
    assert model.convert(Decimal("100"), Decimal("1.0000")) == Decimal("100.00")


def test_single_eur_rate_applied():
    # 100 EUR at 0.92 per USD -> 108.70 USD
    assert model.convert(Decimal("100"), Decimal("0.9200")) == Decimal("108.70")


def test_half_up_line_rounding_tie():
    # A value exactly at the 2dp half-up boundary rounds up.
    assert model.convert(Decimal("0.015"), Decimal("1.0000")) == Decimal("0.02")


def test_latest_rate_returned_single_currency():
    hist = _rates(
        [
            ("EUR", "0.92", "2026-01-01"),
            ("EUR", "0.90", "2026-03-15"),
        ]
    )
    assert hist["EUR"][-1][1] == Decimal("0.90")


if __name__ == "__main__":
    # lightweight runner so the tests can be run without a pytest dependency
    import traceback

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
