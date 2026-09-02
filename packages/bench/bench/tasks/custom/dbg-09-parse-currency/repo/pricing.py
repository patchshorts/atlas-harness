"""Parses currency strings into floats — BUG: strips the decimal point too."""
def parse_amount(s):
    cleaned = s.replace("$", "").replace(",", "").replace(".", "")
    return float(cleaned)
