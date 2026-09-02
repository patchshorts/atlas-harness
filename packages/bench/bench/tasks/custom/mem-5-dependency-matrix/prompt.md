Add module svc_c.py: it exposes svc_c_dedupe(items) returning de-duplicated items
using core.normalize for comparison. It may import ONLY core (stdlib is fine) —
util is NOT allowed for svc_c (see DEPENDENCIES.md), and legacy is never
imported by anyone. Then update DEPENDENCIES.md: add an svc_c row and keep the
table's column alignment. Do not modify util.py, core.py, svc_a.py, or svc_b.py.
