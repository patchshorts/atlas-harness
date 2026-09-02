import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from clamp import clamp


def test_in_range():
    assert clamp(5, 0, 10) == 5
def test_low():
    assert clamp(-3, 0, 10) == 0
def test_high():
    assert clamp(12, 0, 10) == 10
def test_edge():
    assert clamp(0, 0, 10) == 0 and clamp(10, 0, 10) == 10