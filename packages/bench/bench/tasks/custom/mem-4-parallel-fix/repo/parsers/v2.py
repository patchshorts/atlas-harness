"""CSV line parser v2 (near-identical twin of v1)."""
def parse_line(line: str) -> dict:
    parts = []
    buf, in_q = "", False
    for ch in line:
        if ch == '"':
            in_q = not in_q
            continue
        if ch == "," and not in_q:
            parts.append(buf); buf = ""
            continue
        buf += ch
    parts.append(buf)
    if len(parts) < 2:
        raise ValueError("too few fields")
    return {"id": parts[0].strip(), "name": parts[1].strip()}
