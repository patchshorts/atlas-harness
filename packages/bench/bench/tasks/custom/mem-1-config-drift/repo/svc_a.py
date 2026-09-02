"""SVC_A — intake worker."""
from config import load

def connect(cfg):
    return f"{cfg['host']}:{cfg['port']}"

def get_timeout(cfg):
    return cfg["request_timeout"]
