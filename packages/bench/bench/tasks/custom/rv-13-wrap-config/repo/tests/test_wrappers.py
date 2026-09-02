import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from wrappers import wrap

def test_honors_config():
    assert wrap("hello world") == "hello worl..."  # len 11 > MAX_LEN 10
def test_short_unchanged():
    assert wrap("hi") == "hi"
def test_long_truncates():
    # len 11 > MAX_LEN 10 -> first 10 chars + "..."
    assert wrap("abcdefghijk") == "abcdefghij..."