"""Entry point — implement T3 per TODO.md."""
import sys
import src.feature as feature

if __name__ == "__main__":
    items = feature.load_items(sys.argv[1])
    print(len(feature.dedupe(items)))
