import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from buffer import add_item

def test_isolated():
    a = add_item("x")
    b = add_item("y")
    assert a == ["x"]
    assert b == ["y"]
