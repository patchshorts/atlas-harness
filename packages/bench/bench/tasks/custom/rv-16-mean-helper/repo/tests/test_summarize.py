import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from summarize import summarize


def test_fraction():
    assert summarize([2, 3]) == 2.5
def test_empty():
    assert summarize([]) == 0
def test_negative():
    assert summarize([1, 1, 1]) == 1.0