Fix `repo/batches.py` so `batches` satisfies its full contract, which is binding.

The docstring in `repo/batches.py` IS the contract. The visible tests only cover the happy path — the verifier also checks that invalid input raises. Implement every clause.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Read the full docstring contract; honor the error clause.
- Run `python3 -m pytest tests/ -q`, then `./verify.sh repo` to confirm the whole contract.