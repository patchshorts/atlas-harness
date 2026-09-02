import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from validator import validate

SCHEMA = {
    "name": {"type": "str", "required": True},
    "age": {"type": "int", "required": True},
    "note": {"type": "str", "required": False},
}

def test_valid():
    assert validate({"name": "a", "age": 1}, SCHEMA) is True

def test_missing_required():
    with pytest.raises(KeyError):
        validate({"name": "a"}, SCHEMA)

def test_type_mismatch():
    with pytest.raises(TypeError):
        validate({"name": "a", "age": "not-an-int"}, SCHEMA)

def test_optional_absent_ok():
    assert validate({"name": "a", "age": 2}, SCHEMA) is True
