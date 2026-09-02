import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from zscore import zscore


def test_positive():
    z = zscore([2, 4, 4, 4, 5])
    assert len(z) == 5
    assert z[0] < 0 and z[-1] > 0
def test_counts():
    assert zscore([1, 2, 3, 4, 5]) == zscore([1, 2, 3, 4, 5])