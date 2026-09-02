import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from session_store import SessionStore

def test_put_collect_all():
    s = SessionStore()
    s.put("b", 2); s.put("a", 1)
    assert s.collect() == [1, 2]

def test_collect_selected():
    s = SessionStore()
    s.put("x", 10); s.put("y", 20)
    assert s.collect(["y"]) == [20]

def test_accumulation_contract():
    s = SessionStore()
    s.put("k1", "v1")
    first = s.collect()
    s.put("k2", "v2")
    second = s.collect()
    assert first == ["v1"]
    assert second == ["v1", "v2"]  # both no-arg calls return the store
