import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from calculator import compute

def test_sum():
    assert compute({"a": 1, "b": 2, "c": 3}) == 6

def test_empty():
    assert compute({}) == 0

def test_negative():
    assert compute({"x": -5, "y": 5}) == 0
