import json
import pathlib

INTER = pathlib.Path("data/intermediate.json")
OUT = pathlib.Path("data/report.txt")


def summarize() -> list[str]:
    # MUST read the handoff artifact (intermediate.json), never the raw input.
    data = json.loads(INTER.read_text())
    rows = data.get("orders", [])
    lines = []
    for row in rows:
        # per the shared schema, the field is 'total' (amount*1 for the demo)
        lines.append(f"{row['id']}:{row['total']}")
    return lines


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(summarize()) + "\n")


if __name__ == "__main__":
    main()