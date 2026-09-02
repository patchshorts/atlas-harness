from config import load

FILE_CFG = {"max_retries": 5}

def get_max_retries(env):
    # Bug: reads env only, ignores file config and default
    raw = env.get("X_MAX_RETRIES")
    if raw is not None:
        return int(raw)
    return 3
