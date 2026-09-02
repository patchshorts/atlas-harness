import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from summary import row_totals

def test_rows():
    assert row_totals([[1,2],[3,4]]) == [3,7]
def test_single():
    assert row_totals([[5]]) == [5]
def test_empty_rows():
    assert row_totals([[],[]]) == [0,0]
