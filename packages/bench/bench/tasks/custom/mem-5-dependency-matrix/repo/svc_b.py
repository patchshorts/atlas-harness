from core import normalize

def svc_b_count(items):
    return len({normalize(i) for i in items})
