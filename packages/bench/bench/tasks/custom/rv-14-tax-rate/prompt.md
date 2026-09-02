Fix `repo/tax.py` so `total` behaves correctly. The default in one file may mislead.

Goal:
`total(price)` returns the price plus the configured fee. The fee rate is authoritative in `repo/rate.py` and `total` must use it, not a hardcoded figure.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change any public function signature.
- Read more than one file to find where the real defect lives.
- Run `python3 -m pytest tests/ -q` after your fix and confirm it passes.