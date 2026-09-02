"""Shared logger. print() is forbidden in modules/."""
import sys

def log_info(msg: str):
    print(f"[info] {msg}", file=sys.stderr)

def log_error(msg: str):
    print(f"[error] {msg}", file=sys.stderr)
