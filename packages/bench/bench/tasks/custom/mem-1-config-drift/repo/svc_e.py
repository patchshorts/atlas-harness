"""SVC_E — intake worker."""
# FIX: import load from config

def connect(cfg):
    return f"{cfg['host']}:{cfg['port']}"

def get_timeout(cfg):
    return cfg["request_timeout"]  # FIX: cfg is undefined (load import missing)
