import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from paging import paginate

def test_chunks():
    assert paginate([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
def test_short_last():
    assert paginate([1, 2, 3, 4, 5, 6], 4) == [[1, 2, 3, 4], [5, 6]]
def test_empty():
    assert paginate([], 3) == []