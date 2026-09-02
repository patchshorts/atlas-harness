"""Naive CSV parser (no quoted-field handling)."""
def parse(text):
    rows = []
    for line in text.strip().splitlines():
        rows.append([f.strip() for f in line.split(",")])
    return rows
