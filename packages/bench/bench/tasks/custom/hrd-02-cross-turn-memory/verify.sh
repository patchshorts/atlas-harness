#!/usr/bin/env bash
set -e
WS="${1:-.}"
LOG="${2:-}"
cd "$WS"

# Fail loudly if the spec file was NOT deleted — the handoff simulation
# depends on it.
if [ -f SPEC.md ]; then
  echo "SPEC.md still present — handoff not simulated"; exit 1
fi

# The capability gate: the memory retain tool must have been used.
# The session log (additive arm writes tool events) must show a retain /
# memory-write call. Clone arm has no memory tool — this check is what
# makes the task pass ONLY on the additive arm.
if [ -n "$LOG" ] && [ -f "$LOG" ]; then
  if ! grep -qiE '"type": *"tool/call".{0,300}"name": *"(retain|memory|memor)' "$LOG"; then
    echo "no memory retain call in session log"; exit 1
  fi
fi

# config.json must exist and cover every SPEC.md key with exact values.
python3 - <<'PY'
import json, pathlib, re, sys
spec = pathlib.Path("SPEC.md").read_text() if pathlib.Path("SPEC.md").exists() else None
cfg_path = pathlib.Path("config.json")
if not cfg_path.exists():
    print("config.json missing"); sys.exit(1)
cfg = json.loads(cfg_path.read_text())

# Expected key->value pairs derived from SPEC.md (ground truth snapshot).
expected = {
    "service_name": "aurora-api",
    "service_owner": "platform-team",
    "on-call": "platform-oncall@example.com",
    "runtime": "nodejs",
    "node_version": "20.11.1",
    "process_count": 4,
    "max_old_space": 2048,
    "port": 8443,
    "protocol": "https",
    "tls_min": 1.3,
    "expose_public": False,
    "db_engine": "postgres",
    "db_host": "aurora-db.internal",
    "db_port": 5432,
    "db_name": "aurora_prod",
    "db_user": "aurora_app",
    "db_pool_max": 25,
    "cache_engine": "redis",
    "cache_host": "aurora-cache.internal",
    "cache_port": 6379,
    "cache_db": 3,
    "ttl_seconds": 3600,
    "auth_mode": "oidc",
    "oidc_issuer": "https://id.example.com/",
    "oidc_audience": "aurora-api-prod",
    "session_ttl_minutes": 90,
    "feature_webhooks": "enabled",
    "feature_retries": "enabled",
    "feature_rate_limit": "enabled",
    "feature_dark_mode": "disabled",
    "feature_beta_api": "disabled",
    "secret_db_password": "SECRET_DB_PASSWORD",
    "secret_redis_password": "SECRET_REDIS_PASSWORD",
    "secret_oidc_client": "SECRET_OIDC_CLIENT",
    "release_channel": "stable",
    "rollout_percent": 100,
    "rollback_limit": 3,
}

# Flatten config.json (support nested dicts).
def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}" if not prefix else key
        key = k if not prefix else f"{prefix}.{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out

flat = flatten(cfg)
missing = [k for k in expected if k not in flat]
wrong = [k for k in expected if k in flat and flat[k] != expected[k]]
if missing:
    print("MISSING KEYS:", missing); sys.exit(1)
if wrong:
    print("WRONG VALUES:", {k: (flat[k], expected[k]) for k in wrong}); sys.exit(1)
print("MEMORY-CONFIG-OK")
PY
