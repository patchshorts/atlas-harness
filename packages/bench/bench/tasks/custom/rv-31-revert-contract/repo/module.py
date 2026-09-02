"""clamp — broken state: upper-bound guard dropped (rv-31-revert-contract)."""
def clamp(v: float, lo: float, hi: float) -> float:
    if hi < lo:
        raise ValueError("hi must be >= lo")
    if v < lo:
        return lo
    # BUG: the (v > hi) -> hi guard was removed by a bad edit; silently passes high values through.
    return v