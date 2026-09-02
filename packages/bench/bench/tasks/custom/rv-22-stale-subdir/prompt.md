Fix `repo/reader.py` so `load_ids` behaves correctly.

Goal:
`load_ids()` returns the first CSV column values of the repo-local `tokens.csv` (beside the module). The code points at a stale nested `data/` directory that does not exist.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- The data file lives in `repo/`, beside `reader.py`; fix the stale directory reference.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.