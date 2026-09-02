"""Canonical retry schema (single source of truth). Do not modify."""
DEFAULTS = {"max_retries": 3}
ENV_PREFIX = {"svc_x": "X", "svc_y": "Y", "svc_z": "Z"}
FILE_KEY = "max_retries"

def load(service, file_cfg, env):
    """file_cfg: dict from the service's file config; env: os.environ."""
    value = DEFAULTS["max_retries"]
    if FILE_KEY in file_cfg:
        value = file_cfg[FILE_KEY]
    prefix = ENV_PREFIX[service] + "_"
    raw = env.get(prefix + "MAX_RETRIES")
    if raw is not None:
        try:
            value = int(raw)
        except ValueError:
            pass  # invalid env -> keep file/default value
    return value
