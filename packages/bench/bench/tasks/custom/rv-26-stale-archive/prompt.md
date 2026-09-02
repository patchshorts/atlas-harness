Fix `repo/resolve.py` so `read_id` behaves correctly.

Goal:
`read_id()` loads the repo-local `mapping.json` (beside the module) and returns its `id`. The code points into a stale `archive/` directory.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- The data file lives in `repo/`, beside `resolve.py`; fix the stale directory reference.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.