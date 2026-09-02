Fix the five services (svc_a.py .. svc_e.py) so every service's effective request
timeout comes from the canonical config schema in config.py. Rules:
1. Default is 30 seconds (DEFAULTS in config.py).
2. Environment override is <PREFIX>_REQUEST_TIMEOUT per service, using the
   ENV_PREFIX table in config.py.
3. An invalid (non-integer) env value falls back to the default.
Do not modify config.py. Do not add new files. All tests in tests/ must pass.
