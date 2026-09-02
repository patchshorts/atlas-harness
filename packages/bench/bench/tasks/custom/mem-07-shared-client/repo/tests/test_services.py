import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client import ApiClient
from service_a import fetch_user
from service_b import create_user
from service_c import list_users

def test_all_through_contract():
    c = ApiClient("http://x")
    assert fetch_user(c, 1)["ok"] is True
    assert create_user(c, {})["ok"] is True
    assert list_users(c)["ok"] is True
    methods = [m for m, _ in c.calls]
    assert all(m in ("GET", "POST") for m in methods), methods
