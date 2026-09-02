import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tax import total

def test_uses_rate():
    assert total(100) == 105.0
def test_zero():
    assert total(0) == 0.0