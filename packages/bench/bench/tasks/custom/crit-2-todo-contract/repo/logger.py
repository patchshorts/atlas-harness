"""Logging only via this module in src/."""
import sys

def log(msg: str):
    print(f"[feature] {msg}", file=sys.stderr)
