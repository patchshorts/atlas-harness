"""Worker B: reads the artifact and writes a report."""
import json, pathlib

def report():
    # Bug: reads the raw input file, not the handoff artifact
    raw = pathlib.Path("data/raw.json").read_text()
    data = json.loads(raw)
    lines = []
    for order in data:
        lines.append(f"{order['id']}:{order['amount']}")
    pathlib.Path("data/report.txt").write_text("\n".join(lines) + "\n")
