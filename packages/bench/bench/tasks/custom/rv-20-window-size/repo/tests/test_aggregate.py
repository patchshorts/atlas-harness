import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aggregate import rolling_mean


def test_uses_window_constant():
    # last WINDOW(3) of [1,2,3,4] = [2,3,4] -> mean 3.0
    assert rolling_mean([1, 2, 3, 4]) == 3.0
def test_fewer_than_window():
    assert rolling_mean([5]) == 5.0
def test_empty():
    assert rolling_mean([]) == 0