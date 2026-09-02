# SPEC — Deployment Configuration Reference (authoritative)

This file defines the exact production configuration for the `aurora-api`
service. All values here are binding. A second operator will ask you for
these values LATER in the session, after this file has been deleted. You
cannot re-read this file at that point.

## Service identity
- service_name: aurora-api
- service_owner: platform-team
- on-call: platform-oncall@example.com

## Runtime
- runtime: nodejs
- node_version: 20.11.1
- process_count: 4
- max_old_space: 2048 (MB)

## Network
- port: 8443
- protocol: https
- tls_min: 1.3
- expose_public: false

## Database
- db_engine: postgres
- db_host: aurora-db.internal
- db_port: 5432
- db_name: aurora_prod
- db_user: aurora_app
- db_pool_max: 25

## Cache
- cache_engine: redis
- cache_host: aurora-cache.internal
- cache_port: 6379
- cache_db: 3
- ttl_seconds: 3600

## Auth
- auth_mode: oidc
- oidc_issuer: https://id.example.com/
- oidc_audience: aurora-api-prod
- session_ttl_minutes: 90

## Feature flags (all must be recorded)
- feature_webhooks: enabled
- feature_retries: enabled
- feature_rate_limit: enabled
- feature_dark_mode: disabled
- feature_beta_api: disabled

## Secrets (names only — never values)
- secret_db_password: SECRET_DB_PASSWORD
- secret_redis_password: SECRET_REDIS_PASSWORD
- secret_oidc_client: SECRET_OIDC_CLIENT

## Rollout
- release_channel: stable
- rollout_percent: 100
- rollback_limit: 3
