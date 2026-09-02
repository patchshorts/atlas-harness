Fix `repo/fileload.py` so `load_lines` behaves correctly.

Goal:
`load_lines()` returns the non-empty lines of the repo-local `rows.txt` (beside the module). The code walks UP into a stale parent directory with `".."`.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- The data file lives in `repo/`, beside `fileload.py`; remove the wrong parent reference.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.