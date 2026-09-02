Migrate repo/ to the new config API so all tests pass. The old
connect(host, port, user) is deprecated; the new API is connect(cfg) where
cfg is a dict with host/port/user keys. BOTH call sites must be migrated —
one lives in main.py, the other in a subpackage. Do not modify tests/.