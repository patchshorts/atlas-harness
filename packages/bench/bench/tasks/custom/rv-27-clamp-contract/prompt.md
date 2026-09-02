Fix `repo/clamp.py` so `clamp` satisfies its **full contract**, which is binding.

The docstring in `repo/clamp.py` IS the contract. Implement every clause of it — the verifier checks the whole contract, not just the visible tests.

Hard rules:
- Do NOT modify anything under `tests/`.
- Do NOT change the public function signature.
- Read the function's docstring carefully; it requires behavior beyond what the tests exercise.
- Run `python3 -m pytest tests/ -q` after your fix; then run `./verify.sh repo` to confirm the full contract passes.