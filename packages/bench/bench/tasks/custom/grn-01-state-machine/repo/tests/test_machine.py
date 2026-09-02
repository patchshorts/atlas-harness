import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from machine import validate_transition

def test_valid():
    assert validate_transition("IDLE", "start") == "RUNNING"
    assert validate_transition("RUNNING", "finish") == "DONE"
    assert validate_transition("DONE", "reset") == "IDLE"

def test_invalid_raises():
    with pytest.raises(ValueError):
        validate_transition("IDLE", "finish")

def test_unknown_action_noop():
    assert validate_transition("RUNNING", "pause") == "RUNNING"
