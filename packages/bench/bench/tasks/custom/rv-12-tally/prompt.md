Fix `repo/tally.py` so `tally` behaves correctly.

Goal:
`tally(text)` counts alphabetic characters case-insensitively: 'A' and 'a' both count toward key 'a'. Non-alphabetic characters are ignored.

Hard rules:

- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.