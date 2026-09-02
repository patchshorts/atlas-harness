Fix repo/cache.py so all tests pass. get(key) must return the cached value
while it is fresh (TTL seconds) and recompute after expiry. The hit-count
property must count only fresh reads. Do not modify tests/.