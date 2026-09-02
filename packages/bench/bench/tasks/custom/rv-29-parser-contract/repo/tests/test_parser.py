import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from parser import parse


def test_well_formed():
    assert parse("alpha,42") == {"name": "alpha", "value": "42"}
def test_trims():
    assert parse("  alpha  ,  42  ") == {"name": "alpha", "value": "42"}