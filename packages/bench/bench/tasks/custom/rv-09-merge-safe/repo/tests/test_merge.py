import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from merge import merge_dict

def test_input_not_mutated():
    a = {"x": 1}
    out = merge_dict(a, {"y": 2})
    assert out == {"x": 1, "y": 2}
    assert a == {"x": 1}
def test_override():
    assert merge_dict({"x": 1}, {"x": 9}) == {"x": 9}