Fix `repo/flatten.py` so `flatten` behaves correctly.

Goal:
`flatten(xs)` must flatten a nested list of ARBITRARY depth into a flat list of its leaf elements.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.