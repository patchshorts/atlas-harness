from config import load

FILE_CFG = {"max_retries": 7}

def get_max_retries(env):
    # Bug: reads file only, ignores env override
    return FILE_CFG["max_retries"]
