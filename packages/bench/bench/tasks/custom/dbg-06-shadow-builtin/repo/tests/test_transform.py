import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from transform import to_list
import legacy

def test_to_list_tuple():
    assert to_list((1, 2, 3)) == [1, 2, 3]

def test_to_list_generator():
    assert to_list(x * 2 for x in range(3)) == [0, 2, 4]

def test_legacy_export_preserved():
    assert legacy.LEGACY_LIST == ["legacy", "export"]
