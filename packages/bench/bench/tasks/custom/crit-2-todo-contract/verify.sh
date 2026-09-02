#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
python3 - <<'PY'
import pathlib, sys
src = pathlib.Path("src/feature.py").read_text()
if "print(" in src:
    print("print() in src/"); sys.exit(1)
if "logger" not in src:
    print("logger not used"); sys.exit(1)
errors = pathlib.Path("errors.py").read_text()
if "E_NO_FILE" not in errors:
    print("E_NO_FILE not registered"); sys.exit(1)
todo = pathlib.Path("TODO.md").read_text()
if "[ ]" in todo:
    print("unflipped TODO item"); sys.exit(1)
print("CONTRACT-OK")
PY
python3 - <<'PY'
import pathlib, tempfile, subprocess, sys, os
d = tempfile.mkdtemp()
p = pathlib.Path(d) / "items.txt"
p.write_text("a\nb\na\nc\n")
r = subprocess.run([sys.executable, "run.py", str(p)], capture_output=True, text=True)
assert r.stdout.strip() == "3", (r.stdout, r.stderr)
print("RUN-OK")
PY
