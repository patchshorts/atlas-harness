Migrate repo/ from the legacy JSON config schema to the new YAML schema so
all tests pass. Legacy keys: port/host. New keys: listen_port/bind_host.
BOTH the legacy JSON fixture and the new YAML fixture must load correctly.
Do not modify tests/ or fixtures/.