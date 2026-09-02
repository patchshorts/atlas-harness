import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from format import salutation


def test_strip_and_lower():
    assert salutation("  JOE  ") == "Dear joe"
def test_already_clean():
    assert salutation("ana") == "Dear ana"