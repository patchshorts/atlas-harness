Fix `repo/loader.py` so `load_settings` behaves correctly.

Goal:
`load_settings()` reads the repo-local `settings.json` (it sits next to the module in `repo/`). The code resolves a STALE path to a subdirectory that does not exist — point it at the correct repo-local file.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- The data file lives in `repo/`, beside `loader.py`; fix the stale directory reference.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.