import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lower import lower_bound

def test_mid():
    assert lower_bound([1,3,5], 4) == 2
def test_exact_even():
    assert lower_bound([1,3,5,7], 3) == 1
def test_gt_all():
    assert lower_bound([1,3], 9) == 2
def test_lt_all():
    assert lower_bound([1,3], 0) == 0
def test_exact_odd():
    assert lower_bound([2,4,6], 4) == 1
