"""SVC_C — intake worker."""
from config import load

def connect(cfg):
    return f"{cfg['host']}:{cfg['port']}"

def get_timeout(cfg):
    return 10  # FIX: must honor config request_timeout
