"""Token bucket with a refill bug (refills to full capacity on every check)."""
import time

class TokenBucket:
    def __init__(self, rate, capacity):
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.last = time.monotonic()

    def _refill(self):
        now = time.monotonic()
        elapsed = now - self.last
        self.last = now
        self.tokens = self.capacity  # bug: full refill, no accumulation

    def take(self):
        self._refill()
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False
