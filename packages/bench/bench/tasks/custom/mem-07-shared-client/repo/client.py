"""Shared API client. Public contract: get(path), post(path, body)."""
class ApiClient:
    def __init__(self, base):
        self.base = base
        self.calls = []

    def get(self, path):
        self.calls.append(("GET", path))
        return {"ok": True, "method": "get", "path": path}

    def post(self, path, body):
        self.calls.append(("POST", path))
        return {"ok": True, "method": "post", "path": path}
