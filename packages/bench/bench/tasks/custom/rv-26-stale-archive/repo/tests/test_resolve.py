import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from resolve import read_id


def test_id():
    assert read_id() == 7