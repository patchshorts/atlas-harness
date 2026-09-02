import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "parsers"))
import v1, v2

CASES = [
    ('a1,Alice', {"id": "a1", "name": "Alice"}),
    ('b2,"Smith, Bob"', {"id": "b2", "name": "Smith, Bob"}),
    ('c3,"Doe, Jane"', {"id": "c3", "name": "Doe, Jane"}),
    ('d4,Plain', {"id": "d4", "name": "Plain"}),
]

def test_v1():
    for line, want in CASES:
        assert v1.parse_line(line) == want, line

def test_v2():
    for line, want in CASES:
        assert v2.parse_line(line) == want, line

def test_v1_quoted_with_trailing():
    assert v1.parse_line('e5,"Quoted, End"') == {"id": "e5", "name": "Quoted, End"}

def test_v2_quoted_with_trailing():
    assert v2.parse_line('e5,"Quoted, End"') == {"id": "e5", "name": "Quoted, End"}

def test_too_few_fields():
    for mod in (v1, v2):
        try:
            mod.parse_line("onlyone")
            assert False, "should raise"
        except ValueError:
            pass
