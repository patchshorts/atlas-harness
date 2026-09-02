"""Canonical service configuration schema (single source of truth).

Every service reads its effective config through load(). Do not modify this file.
"""
DEFAULTS = {
    "host": "127.0.0.1",
    "port": 8080,
    "request_timeout": 30,  # seconds, int
}
ENV_PREFIX = {
    "svc_a": "SVC_A", "svc_b": "SVC_B", "svc_c": "SVC_C",
    "svc_d": "SVC_D", "svc_e": "SVC_E",
}

def load(service: str, env: dict) -> dict:
    cfg = dict(DEFAULTS)
    prefix = ENV_PREFIX[service] + "_"
    for key in list(cfg):
        val = env.get(prefix + key.upper())
        if val is not None:
            try:
                cfg[key] = int(val)
            except ValueError:
                pass  # invalid env value falls back to default
    return cfg
