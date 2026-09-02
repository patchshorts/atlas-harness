import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from flatten import flatten

def test_deep():
    assert flatten([[1, [2]], [3, [4, [5]]]]) == [1, 2, 3, 4, 5]
def test_flat():
    assert flatten([[1], [2]]) == [1, 2]
def test_empty():
    assert flatten([]) == []