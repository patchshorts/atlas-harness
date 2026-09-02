import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from reader import read_lines

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def test_utf8():
    assert read_lines(os.path.join(HERE, "fixtures", "a_utf8.txt")) == ["hello world", "second line"]

def test_utf16_bom():
    lines = read_lines(os.path.join(HERE, "fixtures", "b_utf16.txt"))
    assert lines == ["こんにちは", "世界"]
