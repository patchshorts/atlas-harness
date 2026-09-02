"""Central error codes."""
class FeatureError(Exception):
    def __init__(self, code: str, msg: str):
        super().__init__(f"[{code}] {msg}")
        self.code = code

CODES = {
    "E_NO_FILE": "file does not exist",
}
