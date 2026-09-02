# Policy — Multi-Currency Finance Model

This policy governs the conversion of the multi-currency transaction ledger
to USD for the finance reporting team.

## §1 Scope

Source data lives in two files in this directory:

- `transactions.csv` — one row per transaction:
  `date, region, currency, amount`. The `amount` is an integer in the row's
  currency.
- `rates.csv` — one row per currency per effective date:
  `currency, rate, effective_from`. `rate` is the number of units of that
  currency per 1 USD (so USD itself is `1.0000`, and a higher number means
  the currency is worth less per dollar).

## §2 Conversion — effective-date rate

Convert a transaction to USD by dividing its `amount` by the exchange rate
**effective on the transaction date**. The rate table stores multiple
effective dates per currency. Use the most recent rate whose `effective_from`
is on or before the transaction date.

Do **not** use the latest rate for every row. That produces a materially wrong
total whenever rates moved during the period.

## §3 Summary

The finance summary reports, in USD:

- one subtotal per currency (all transactions in that currency, converted),
- a grand total across all currencies,
- one subtotal per region (the regional breakout, §4).

**Rounding:** round each converted line half-up to 2 decimal places at the
*line* level, before forming any subtotal or total. Do **not** round at the
total — the difference lands in the last cent.

## §4 Regional breakout

The regional subtotals must re-aggregate the already-rounded per-line USD
values. Re-summing raw (unrounded) rows regionally produces cents of drift and
is forbidden. The regional subtotals must therefore sum exactly to the grand
total.
