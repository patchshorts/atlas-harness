Fix `repo/report.py` so `render_header` behaves correctly. `repo/report.py` uses `repo/indent.py`.

`render_header()` returns `"    HDR"` (four leading spaces). The indentation builder lives in `repo/indent.py` and is off by one level.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change any public function signature.
- Read both files; fix the off-by-one in the indent helper.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.