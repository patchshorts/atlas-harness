"""Datetime helpers."""
from datetime import datetime, timezone

def now_utc(tz=None):
    """Return the current UTC time. tz is ignored today (bug)."""
    return datetime.utcnow()

def to_epoch(dt):
    return int(dt.timestamp())
