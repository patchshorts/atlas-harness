import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from reader import load_ids


def test_first_column():
    assert load_ids() == ["1", "2", "3"]