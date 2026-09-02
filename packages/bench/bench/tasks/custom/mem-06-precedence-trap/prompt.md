Fix the three services (svc_x.py, svc_y.py, svc_z.py) so every service's
effective max_retries comes from the canonical schema in config.py. Rules:
1. Default is 3 (DEFAULTS in config.py).
2. A per-service FILE config overrides the default.
3. An ENV override (<PREFIX>_MAX_RETRIES) beats the file config.
4. An invalid (non-integer) env value falls back to the FILE value, then the
   default.
Do not modify config.py. Do not add new files. All tests in tests/ must pass.