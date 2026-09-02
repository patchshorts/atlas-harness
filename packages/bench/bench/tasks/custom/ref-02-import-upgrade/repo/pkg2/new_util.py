def parse(text):
    out = {}
    for line in text.strip().splitlines():
        k, _, v = line.partition("=")
        k = k.strip()
        if k in out:
            raise ValueError(f"duplicate key: {k}")
        out[k] = v.strip()
    return out
