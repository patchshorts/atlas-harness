Fix `repo/rotate.py` so `rotate` behaves correctly.

Goal:
`rotate(items, k)` shifts the list RIGHT by `k` positions, where `k` may be zero, larger than the list length, or the list may be empty (result must then be the same/empty list).

Hard rules:

- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.