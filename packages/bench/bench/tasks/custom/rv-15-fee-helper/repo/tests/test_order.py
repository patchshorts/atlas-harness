import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from order import order_total


def test_shipping_exact():
    # shipping should be 2 * 2 = 4, so total = 100 + 4
    assert order_total(100, 2) == 104
def test_zero_weight():
    assert order_total(50, 0) == 50