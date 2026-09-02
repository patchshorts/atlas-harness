import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from conf_reader import read_port


def test_port():
    assert read_port() == 8080