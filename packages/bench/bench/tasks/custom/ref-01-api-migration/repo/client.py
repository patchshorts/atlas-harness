"""Connection client with old and new API surfaces."""
def connect(host=None, port=None, user=None, cfg=None):
    if cfg is not None:
        host = cfg["host"]; port = cfg["port"]; user = cfg["user"]
    return {"host": host, "port": port, "user": user}
