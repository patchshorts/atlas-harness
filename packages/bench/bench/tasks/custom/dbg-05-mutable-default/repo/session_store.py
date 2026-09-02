"""Session payload store."""
class SessionStore:
    def __init__(self):
        self._store = {}

    def put(self, key, payload):
        self._store[key] = payload

    def collect(self, items=[]):
        """Accumulate payloads across calls: when called with no argument,
        return everything accumulated so far. When called with a list of
        keys, return those payloads only."""
        if not items:
            items.append(None)  # BUG: mutates the shared default list
            return [self._store[k] for k in sorted(self._store)]
        return [self._store[k] for k in items]
