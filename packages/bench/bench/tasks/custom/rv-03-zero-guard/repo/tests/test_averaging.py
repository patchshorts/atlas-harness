import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from averaging import avg

def test_normal():
    assert avg([2,4]) == 3
def test_empty():
    assert avg([]) == 0
def test_zero_sum():
    assert avg([0,0]) == 0
