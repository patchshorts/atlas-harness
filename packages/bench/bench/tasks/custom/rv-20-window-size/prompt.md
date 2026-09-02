Fix `repo/aggregate.py` so `rolling_mean` behaves correctly. The window size is authoritative in `repo/window.py`.

`rolling_mean(values)` returns the mean of the LAST `WINDOW` elements (from `repo/window.py`), averaging fewer if there aren't that many. The aggregator ignores the configured window.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change any public function signature.
- Read both files; the aggregator must use `WINDOW`.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.