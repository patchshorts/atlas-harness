"""Reads server config; currently JSON-only (legacy schema)."""
import json

def load_config(path):
    with open(path) as f:
        data = json.load(f)
    return {"host": data.get("host", "127.0.0.1"),
            "port": data.get("port", 8080)}
