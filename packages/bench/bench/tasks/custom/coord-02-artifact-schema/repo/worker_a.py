"""Worker A: writes the processed artifact (id + derived total per order)."""
import json, pathlib

def process(orders):
    pathlib.Path("data").mkdir(exist_ok=True)
    out = {}
    for order in orders:
        out[order["id"]] = {"id": order["id"], "total": order["amount"] * 2}
    pathlib.Path("data/processed.json").write_text(json.dumps(out))
    return out
