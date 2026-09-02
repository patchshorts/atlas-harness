import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bucket import TokenBucket

def test_initial_capacity():
    b = TokenBucket(rate=10, capacity=5)
    for _ in range(5):
        assert b.take() is True
    assert b.take() is False  # drained

def test_slow_refill():
    b = TokenBucket(rate=10, capacity=1)
    assert b.take() is True
    assert b.take() is False  # no immediate refill
    import time; time.sleep(0.15)
    assert b.take() is True   # refilled: 0.15s * 10/s = 1.5 >= 1

def test_capacity_cap():
    b = TokenBucket(rate=100, capacity=2)
    b.take(); b.take()
    assert b.take() is False  # never exceeds 2 tokens immediately
