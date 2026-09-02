"""contract.py — the full clamp contract, binding (rv-31-revert-contract)."""
def clamp(v: float, lo: float, hi: float) -> float:
    if hi < lo:
        raise ValueError("hi must be >= lo")
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v