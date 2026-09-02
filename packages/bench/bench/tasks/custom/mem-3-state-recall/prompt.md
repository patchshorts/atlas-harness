Fix the order CLI bug: a discount registered with `add --discount <pct> <item>`
must apply at `checkout` in the SAME session. Rules:
1. `start` opens a fresh order (discount must NOT leak across orders).
2. `checkout` reports total=... with the discount applied (integer math).
3. `add` without --discount behaves as today.
Keep the CLI interface identical. All tests in tests/ must pass.
