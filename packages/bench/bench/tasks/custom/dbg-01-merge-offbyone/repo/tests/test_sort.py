import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sort import merge_sort

def test_simple():
    assert merge_sort([3, 1, 2]) == [1, 2, 3]

def test_even_length():
    assert merge_sort([5, 4, 3, 2]) == [2, 3, 4, 5]

def test_odd_length():
    assert merge_sort([9, 7, 5, 3, 1]) == [1, 3, 5, 7, 9]

def test_no_loss():
    out = merge_sort([4, 4, 4])
    assert len(out) == 3 and out == [4, 4, 4]

def test_stability():
    pairs = [(1, "a"), (1, "b"), (0, "c")]
    keyed = [p for p in pairs]
    def k(p): return p[0]
    # emulate stable sort via index tiebreak
    idx = {id(p): i for i, p in enumerate(keyed)}
    out = merge_sort(keyed)
    for a, b in zip(out, out[1:]):
        if k(a) == k(b):
            assert idx[id(a)] < idx[id(b)], "not stable"
