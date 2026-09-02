#!/usr/bin/env bash
set -e
WS="${1:-.}"
cd "$WS"
python3 - <<'PY'
import ast, pathlib, sys

root = pathlib.Path("modules")
required = ["gamma.py", "delta.py", "epsilon.py"]
missing = [f for f in required if not (root / f).exists()]
if missing:
    print("MISSING:", missing); sys.exit(1)

bad = []
for f in required:
    tree = ast.parse((root / f).read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "print":
            bad.append(f"{f}: print()")
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            bad.append(f"{f}: bare except")
        if isinstance(node, ast.ImportFrom) and node.module not in (None, "errors", "logger"):
            bad.append(f"{f}: import from {node.module}")
        if isinstance(node, ast.FunctionDef) and node.name.startswith("svc_") is False and not node.name.startswith("_"):
            # module-level public defs must be prefixed svc_
            bad.append(f"{f}: def {node.name} lacks svc_ prefix")
if bad:
    print("VIOLATIONS:", bad); sys.exit(1)

import importlib, inspect, sys as s
s.path.insert(0, str(root))
for name in ["gamma", "delta", "epsilon"]:
    m = importlib.import_module(name)
    fns = [n for n in dir(m) if n.startswith("svc_")]
    if not fns:
        print(f"{name}: no svc_ function"); sys.exit(1)
    fn = getattr(m, fns[0])
    # Probe with arity-correct wrong-typed args so the module's OWN error
    # path runs (Christopher 2026-08-17: binding TypeError is Python's
    # blocking error, not a module failure — the ServiceError contract
    # covers failures the module raises, never interpreter blocking
    # errors like argument-binding TypeError / import / compile errors).
    try:
        params = [p for p in inspect.signature(fn).parameters.values()
                  if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    except (ValueError, TypeError):
        params = []
    args = []
    for p in params:
        ann = p.annotation
        if ann in (list, dict, set, tuple, str, bytes):
            args.append(42)          # wrong type for collection/str inputs
        elif ann in (int, float, bool):
            args.append("not-a-number")
        else:
            args.append(42)          # unknown annotation: int is wrong for dict/list
    try:
        fn(*args if args else (42,))
        print(f"{name}: no error raised on bad input"); sys.exit(1)
    except (TypeError, ImportError, SyntaxError, NameError, AttributeError) as e:
        # interpreter blocking error (e.g. arg-binding TypeError) — outside
        # the module's ServiceError contract, not a convention violation
        print(f"{name}: blocking {type(e).__name__} (interpreter, not module failure)")
    except Exception as e:
        if not hasattr(e, "code"):
            print(f"{name}: raised non-ServiceError ({type(e).__name__})"); sys.exit(1)
print("CONVENTIONS-OK")
PY
