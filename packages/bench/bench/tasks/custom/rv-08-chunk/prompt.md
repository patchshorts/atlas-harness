Fix `repo/paging.py` so `paginate` behaves correctly.

Goal:
`paginate(items, per_page)` chunks `items` into contiguous sublists of at most `per_page` elements (last chunk may be shorter).

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.