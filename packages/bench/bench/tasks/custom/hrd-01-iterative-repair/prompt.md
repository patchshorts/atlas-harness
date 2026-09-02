Fix the pipeline in repo/pipeline.py so ALL tests in repo/tests/ pass.

The pipeline has five stages — ingest, normalize, filter, aggregate, format —
and the full contract for each stage is documented in the module docstring.
There are SIX bugs seeded in the file. The tests are interdependent:
fixing one bug can cause a different test to fail until the related bug is
also fixed.

Work method:
1. Run `python3 -m pytest tests/ -q` and read every failure.
2. Fix the smallest correct change per failure.
3. Re-run the suite. Expect new failures to appear as old ones clear —
   that is the interdependence working, not a regression you introduced.
4. Repeat until the whole suite is green.

Hard rules:
- Do not modify tests/. Do not change function signatures. Do not add
  dependencies.
- The module docstring contract is binding — the fixes must satisfy it,
  not just the visible tests.
- Run the suite at least once AFTER your final fix to prove green.
