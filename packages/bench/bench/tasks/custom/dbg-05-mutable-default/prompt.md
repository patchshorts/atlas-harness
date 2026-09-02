Fix repo/session_store.py so all tests pass. Look at the docstring of
SessionStore.collect — it documents an ACCUMULATION contract: repeated calls
with no argument must return the accumulated payloads. Do not modify tests/.