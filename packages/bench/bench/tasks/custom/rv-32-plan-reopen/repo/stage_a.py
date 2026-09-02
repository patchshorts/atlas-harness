import json
import pathlib

RAW = pathlib.Path("raw/orders.json")
OUT = pathlib.Path("data/intermediate.json")


def extract() -> list[dict]:
    data = json.loads(RAW.read_text())
    # BUG: writes the raw field name 'amount' instead of the shared 'total'
    # that stage_b must consume. stage_b reads 'total' -> cannot consume.
    rows = []
    for order in data.get("orders", []):
        rows.append(
            {
                "id": order["id"],
                "amount": order["amount"],  # wrong: should write 'total'
            }
        )
    return rows


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"orders": extract()}, indent=2))


if __name__ == "__main__":
    main()