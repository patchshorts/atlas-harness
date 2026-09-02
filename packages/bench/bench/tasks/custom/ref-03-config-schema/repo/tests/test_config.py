import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config_reader import load_config

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def test_legacy_json():
    cfg = load_config(os.path.join(HERE, "fixtures", "legacy.json"))
    assert cfg == {"host": "10.0.0.1", "port": 9000}

def test_new_yaml():
    cfg = load_config(os.path.join(HERE, "fixtures", "new.yaml"))
    assert cfg == {"host": "192.168.1.5", "port": 7000}
