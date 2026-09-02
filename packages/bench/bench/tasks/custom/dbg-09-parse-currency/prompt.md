Fix repo/pricing.py so all tests pass. parse_amount(s) must parse strings
like "$1,234.56", "12.5", and "1,000" into floats. Do not modify tests/.