Fix `repo/wrappers.py` so `wrap` behaves correctly. The fix is not necessarily in one file.

Goal:
`wrap(text)` truncates long text to the configured `MAX_LEN` (lives in `repo/config.py`), appending `...`, and leaves short text unchanged.

The authoritative value lives in `repo/config.py` — `wrap` must honor it, not a hardcoded literal.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change any public function signature.
- You may need to read more than one file; edit the file(s) that hold the real defect.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.