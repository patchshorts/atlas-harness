Fix `repo/unique.py` so `unique_items` behaves correctly.

Goal:
`unique_items(items)` must return the distinct elements of `items` in their original first-seen order.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Run `python3 -m pytest tests/ -q` after your fix and make sure it passes.