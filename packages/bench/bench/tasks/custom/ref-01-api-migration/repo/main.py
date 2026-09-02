from client import connect

def run(host, port, user):
    return connect(host=host, port=port, user=user)  # old API (site 1)
