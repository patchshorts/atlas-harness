"""TTL cache with an inverted expiry check (returns stale values forever)."""
import time

class TtlCache:
    def __init__(self, ttl):
        self.ttl = ttl
        self._data = {}
        self._expires = {}
        self.hits = 0

    def get(self, key, compute):
        if key in self._data:
            if time.monotonic() >= self._expires[key]:  # inverted: fresh ONLY when expired
                self.hits += 1
                return self._data[key]
            self.hits += 1
            return self._data[key]
        value = compute()
        self._data[key] = value
        self._expires[key] = time.monotonic() + self.ttl
        return value
