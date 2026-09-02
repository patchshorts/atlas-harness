You are completing a multi-currency finance model for the treasury team. The
working directory already contains `transactions.csv` (400 transaction rows
across 4 currencies and 4 regions), `rates.csv` (a rate table with an
`effective_from` column), `POLICY.md` (the governing policy), a partially-built
`model.py`, and existing tests under `tests/`.

Work the task in TWO sequential parts and complete BOTH before you finish.
Run your model so it produces `dist/summary.md`.

--- PART 1: complete the model ---
Complete `model.py` so it produces the summary described in `POLICY.md` §3:
one USD subtotal per currency, a grand total across all currencies, and the
required per-region subtotals.

Read `POLICY.md` IN FULL before implementing. It states two rules that the
current stubs ignore: which rate to use for a given transaction (§2) and how
rounding must be applied (§3). The existing single-currency tests under
`tests/` must keep passing; add whatever logic the multi-currency summary
requires.

--- PART 2: regional breakout, totals unchanged ---
Treasury now wants the same summary broken out by region, without changing
the totals you produced in PART 1. Add the regional subtotals to
`dist/summary.md` (and to the model if needed), following `POLICY.md` §4.

The grand total and every per-currency subtotal must remain EXACTLY the values
produced in PART 1. The regional subtotals must sum exactly to the grand total.

Final state required:
- `dist/summary.md` exists.
- Per-currency subtotals, the grand total, and per-region subtotals are all
  present and consistent.
- The grand total is unchanged between PART 1 and PART 2.
- The existing single-currency tests still pass.

Do not stop at PART 1 — both parts are mandatory.
