import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from batches import batches


def test_even():
    assert batches(6, 3) == [3, 3]
def test_remainder():
    assert batches(7, 3) == [3, 3, 1]
def test_single():
    assert batches(2, 5) == [2]