import sys
import pathlib
import importlib.util
import ast as astmod


def load(name: str) -> object:
    path = pathlib.Path(f"{name}.py").resolve()
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


def _raw_reads(path: str) -> list[str]:
    """stage_b must not READ the raw input — check actual I/O, not prose."""
    tree = astmod.parse(pathlib.Path(path).read_text())
    hits = []
    for node in astmod.walk(tree):
        if isinstance(node, astmod.Call):
            f = node.func
            if isinstance(f, astmod.Attribute) and f.attr == "read_text":
                arg = node.args[0] if node.args else None
                txt = astmod.unparse(arg) if arg is not None else ""
                if "raw/" in txt or "orders" in txt:
                    hits.append(txt)
    return hits


def test_stage_a_writes_total_field():
    """stage_a must write the shared 'total' field, not 'amount'."""
    a = load("stage_a")
    rows = a.extract()
    for row in rows:
        assert "total" in row, f"stage_a row missing shared field 'total': {row}"
        assert "amount" not in row, f"stage_a must NOT write 'amount': {row}"


def test_stage_b_reads_intermediate():
    """stage_b must consume the intermediate artifact, never raw input."""
    hits = _raw_reads("stage_b.py")
    assert not hits, f"stage_b must NOT read raw input: {hits}"


def test_end_to_end_schema():
    """The final report must mirror stage_a's shared-schema rows."""
    import subprocess
    subprocess.run([sys.executable, "pipeline.py"], check=True)
    import json
    inter = json.loads(pathlib.Path("data/intermediate.json").read_text())
    report = pathlib.Path("data/report.txt").read_text().strip().splitlines()
    rows = inter.get("orders", []) if isinstance(inter, dict) else inter
    assert len(report) == len(rows), "report line count != intermediate rows"
    for row in rows:
        assert f"{row['id']}:{row['total']}" in report