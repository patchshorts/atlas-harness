Fix `repo/order.py` so `order_total` behaves correctly. The real defect may not be in the file it seems.

`order_total(items_total, weight_kg)` adds the shipping fee. The shipping fee itself is computed in `repo/fees.py` and is DEFINED as exactly `2 * weight_kg`. Inspect both files — the bug may live in the helper, not the caller.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change any public function signature.
- Read more than one file and edit the file that owns the defect.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.