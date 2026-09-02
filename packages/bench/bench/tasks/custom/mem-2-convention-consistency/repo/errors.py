"""Central error-code table. Add new codes here, never inline."""
class ServiceError(Exception):
    def __init__(self, code: str, msg: str):
        super().__init__(f"[{code}] {msg}")
        self.code = code

CODES = {
    "E_NOT_FOUND": "resource not found",
    "E_INVALID": "invalid input",
    "E_TIMEOUT": "operation timed out",
    "E_RATE_LIMIT": "rate limit exceeded",
}
