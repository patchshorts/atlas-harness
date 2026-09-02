Fix `repo/zscore.py` so `zscore` satisfies its full contract, which is binding.

The docstring in `repo/zscore.py` IS the contract. The visible tests only cover a normal multi-element sample — the verifier also checks the length-1 and empty cases. Implement every clause.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Read the full docstring contract; honor the single-element and empty clauses.
- Run `python3 -m pytest tests/ -q`, then `./verify.sh repo` to confirm the whole contract.