import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pydantic import ValidationError
import legacy

def test_valid():
    p = legacy.Payload(name="ok", count=3, tags=["a"])
    assert p.count == 3

def test_negative_count_rejected():
    try:
        legacy.Payload(name="ok", count=-1)
        assert False, "negative count must be rejected"
    except ValidationError:
        pass

def test_blank_name_rejected():
    try:
        legacy.Payload(name="   ", count=1)
        assert False, "blank name must be rejected"
    except ValidationError:
        pass

def test_count_type_coerced():
    assert legacy.Payload(name="ok", count="5").count == 5
