import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fileload import load_lines


def test_lines():
    assert load_lines() == ["apple", "banana", "cherry"]