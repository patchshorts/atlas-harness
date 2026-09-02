import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from rotate import rotate

def test_right_by_one():
    assert rotate([1, 2, 3], 1) == [3, 1, 2]
def test_wrap():
    assert rotate([1, 2, 3], 4) == [3, 1, 2]
def test_k0():
    assert rotate([1, 2, 3], 0) == [1, 2, 3]
def test_full_cycle():
    assert rotate([1, 2, 3], 3) == [1, 2, 3]
def test_empty():
    assert rotate([], 2) == []