Fix `repo/parser.py` so `parse` satisfies its full contract, which is binding.

The docstring in `repo/parser.py` IS the contract. The visible tests only cover well-formed lines — the verifier also checks that a blank field raises. Implement every clause, not just the visible cases.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Read the full docstring contract; honor the error clause.
- Run `python3 -m pytest tests/ -q`, then `./verify.sh repo` to confirm the whole contract.