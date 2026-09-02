import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from loader import load_settings


def test_dir():
    cfg = load_settings()
    assert cfg["theme"] == "dark"
    assert cfg["retries"] == 3