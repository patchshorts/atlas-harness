import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from csvparse import parse

def test_simple():
    assert parse("a,b,c") == [["a", "b", "c"]]

def test_quoted_comma():
    assert parse('x,"hello, world",y') == [["x", "hello, world", "y"]]

def test_escaped_quote():
    assert parse('"say ""hi""",z') == [['say "hi"', "z"]]
