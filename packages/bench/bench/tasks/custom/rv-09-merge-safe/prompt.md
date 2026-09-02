Fix `repo/merge.py` so `merge_dict` behaves correctly.

Goal:
`merge_dict(a, b)` returns a new dict that has `b`'s items overlaid on `a`'s, WITHOUT mutating `a`.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.