def parse(text):
    out = {}
    for line in text.strip().splitlines():
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip()
    return out
