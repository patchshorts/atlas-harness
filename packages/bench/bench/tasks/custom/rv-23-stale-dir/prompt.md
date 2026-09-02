Fix `repo/conf_reader.py` so `read_port` behaves correctly.

Goal:
`read_port()` loads the repo-local `conf.json` (beside the module) and returns its `port`. The code resolves an old nested `old/` directory.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- The data file lives in `repo/`, beside the module; drop the stale directory.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.