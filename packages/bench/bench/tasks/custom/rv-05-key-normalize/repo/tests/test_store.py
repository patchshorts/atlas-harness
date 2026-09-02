import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from store import Store

def test_case_insensitive():
    s = Store()
    s.put("Alpha", 1)
    assert s.get("alpha") == 1
def test_missing():
    assert Store().get("nope") is None
