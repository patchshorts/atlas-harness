Fix `repo/assetloader.py` so `get_text` behaves correctly.

Goal:
`get_text()` returns the trimmed contents of the repo-local `lib.txt` (beside the module). The code wrongly looks under a nested `lib/` directory.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- The data file sits beside `assetloader.py`; fix the stale nested directory.
- Run `python3 -m pytest tests/ -q` after the fix and confirm it passes.