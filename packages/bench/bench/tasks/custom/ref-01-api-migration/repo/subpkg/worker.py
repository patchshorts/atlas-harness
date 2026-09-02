from client import connect

def work(cfg):
    return connect(host=cfg["host"], port=cfg["port"], user=cfg["user"])  # old API (site 2)
