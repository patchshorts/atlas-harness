import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from assetloader import get_text


def test_text():
    assert get_text() == "hello lib"