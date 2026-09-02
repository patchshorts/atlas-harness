Fix `repo/summarize.py` so `summarize` behaves correctly. `repo/summarize.py` delegates to a helper in `repo/metrics.py`.

`summarize(values)` returns the arithmetic mean (a float) of `values`; an empty list yields 0. The mean is computed in `repo/metrics.py` — find and fix the real defect, which may be in `metrics.py`.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change any public function signature.
- Read more than one file; edit the defect's real owner.
- Run `python3 -m pytest tests/ -q` after the fix and confirm it passes.