import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tally import tally

def test_case_insensitive():
    assert tally("AaBbAa") == {"a": 4, "b": 2}
def test_ignores_non_alpha():
    assert tally("a1 b!") == {"a": 1, "b": 1}