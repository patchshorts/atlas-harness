"""SVC_D — intake worker."""
from config import load

def connect(cfg):
    return f"{cfg['host']}:{cfg['port']}"

def get_timeout(cfg):
    return cfg["port"]  # FIX: wrong key — must be request_timeout
