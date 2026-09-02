import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SERVICES = ["svc_a", "svc_b", "svc_c", "svc_d", "svc_e"]

def make_env(service, timeout):
    env = {}
    if timeout is not None:
        from config import ENV_PREFIX
        env[ENV_PREFIX[service] + "_REQUEST_TIMEOUT"] = str(timeout)
    return env

def timeout_of(service, env):
    from config import load
    mod = importlib.import_module(service)
    return mod.get_timeout(load(service, env))

def test_defaults():
    for s in SERVICES:
        assert timeout_of(s, {}) == 30, s

def test_env_override():
    for s in SERVICES:
        assert timeout_of(s, make_env(s, 45)) == 45, s

def test_bad_env_falls_back():
    for s in SERVICES:
        assert timeout_of(s, make_env(s, "abc")) == 30, s
