import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from config_loader import load_config
from legacy import parse as legacy_parse

def test_new_behavior():
    cfg = load_config("a=1\nb=2")
    assert cfg == {"a": "1", "b": "2"}

def test_duplicate_rejected():
    with pytest.raises(ValueError):
        load_config("a=1\na=2")

def test_legacy_shim_keeps_last():
    assert legacy_parse("a=1\na=2") == {"a": "2"}
