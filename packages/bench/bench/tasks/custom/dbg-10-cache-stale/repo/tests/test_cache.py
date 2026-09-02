import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cache import TtlCache

def test_fresh_hit():
    c = TtlCache(ttl=60)
    assert c.get("k", lambda: 1) == 1
    assert c.get("k", lambda: 2) == 1  # fresh -> cached
    assert c.hits == 1

def test_expiry_recomputes():
    c = TtlCache(ttl=0.1)
    assert c.get("k", lambda: 1) == 1
    time.sleep(0.15)
    assert c.get("k", lambda: 2) == 2  # expired -> recompute
