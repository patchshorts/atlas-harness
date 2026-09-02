import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import datetime, timezone
from timeutil import now_utc, to_epoch

def test_aware_utc():
    dt = now_utc()
    assert dt.tzinfo is not None, "must be timezone-aware"
    assert dt.utcoffset().total_seconds() == 0

def test_tz_param_accepted():
    dt = now_utc(tz=timezone.utc)
    assert dt.tzinfo is not None

def test_epoch_roundtrip():
    dt = now_utc()
    assert abs(to_epoch(dt) - int(dt.timestamp())) == 0
