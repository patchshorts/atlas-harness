from core import normalize
from util import canonical_key

def svc_a_find(items, q):
    qk = canonical_key(q)
    return [i for i in items if canonical_key(i) == qk]
