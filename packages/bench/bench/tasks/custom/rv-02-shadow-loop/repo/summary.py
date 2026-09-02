"""Shadow trap: inner var overwrites the total."""
def row_totals(rows):
    out = []
    for row in rows:
        total = 0
        for x in row:
            total = x
        out.append(total)
    return out