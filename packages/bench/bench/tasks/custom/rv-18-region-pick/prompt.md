Fix `repo/deploy.py` so `default_region` behaves correctly. `repo/deploy.py` calls a chooser in `repo/registry.py`.

`default_region()` must return the LOWEST-precedence region, i.e. the LAST entry in `PRIORITY`. The chooser in `repo/registry.py` picks the wrong end.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change any public function signature.
- Read more than one file; the defect is in the chooser.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.