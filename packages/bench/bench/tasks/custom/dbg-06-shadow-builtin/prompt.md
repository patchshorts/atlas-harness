Fix repo/transform.py so all tests pass. The tests import BOTH transform.py
and legacy.py — legacy.py imports a module-level name from transform.py, so
you must keep that export intact while fixing the shadowing bug. Do not
modify tests/.