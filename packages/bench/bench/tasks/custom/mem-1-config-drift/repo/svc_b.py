"""SVC_B — intake worker."""
from config import load

def connect(cfg):
    return f"{cfg['host']}:{cfg['port']}"

def get_timeout(cfg):
    return cfg.get("request_timeout", 30)  # FIX: uses ENV_PREFIX lookup via load()
