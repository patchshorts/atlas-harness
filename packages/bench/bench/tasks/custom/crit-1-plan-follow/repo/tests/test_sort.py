import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))
import stable_sort

def test_sorted():
    assert stable_sort.stable_sort([3, 1, 2]) == [1, 2, 3]

def test_empty_and_single():
    assert stable_sort.stable_sort([]) == []
    assert stable_sort.stable_sort([5]) == [5]

def test_stability():
    pairs = [(2, "a"), (1, "x"), (2, "b"), (1, "y")]
    out = stable_sort.stable_sort(pairs, key=lambda p: p[0])
    keys = [k for k, _ in out]
    assert keys == [1, 1, 2, 2], out
    # stability: original order preserved within equal keys
    assert out[0][1] == "x" and out[1][1] == "y", out
    assert out[2][1] == "a" and out[3][1] == "b", out

def test_duplicates():
    assert stable_sort.stable_sort([2, 2, 1, 1]) == [1, 1, 2, 2]
