import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from deploy import default_region


def test_lowest_precedence():
    assert default_region() == "alpha"