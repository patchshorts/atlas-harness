Fix `repo/format.py` so `salutation` behaves correctly. `repo/format.py` relies on `repo/nameutil.py`.

`salutation(name)` returns `"Dear " + name` where the name is CLEANED: trimmed of surrounding whitespace AND lowercased. The cleaning lives in `repo/nameutil.py` — the defect is in the helper.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change any public function signature.
- Read more than one file; edit the defect's real owner.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.