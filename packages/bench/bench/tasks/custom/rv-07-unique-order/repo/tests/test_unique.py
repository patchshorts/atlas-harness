import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from unique import unique_items

def test_order_preserved():
    assert unique_items([3, 1, 3, 2, 1]) == [3, 1, 2]
def test_empty():
    assert unique_items([]) == []
def test_no_dups():
    assert unique_items([5, 6]) == [5, 6]