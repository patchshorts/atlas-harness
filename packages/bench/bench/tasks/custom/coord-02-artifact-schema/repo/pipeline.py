from worker_a import process
from worker_b import report
import json, pathlib

def main():
    raw = pathlib.Path("data/raw.json").read_text()
    orders = json.loads(raw)
    process(orders)
    report()

if __name__ == "__main__":
    main()
