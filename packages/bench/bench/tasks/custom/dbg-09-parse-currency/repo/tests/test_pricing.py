import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pricing import parse_amount

def test_plain():
    assert parse_amount("12.5") == 12.5

def test_dollar_commas():
    assert parse_amount("$1,234.56") == 1234.56

def test_commas_no_cents():
    assert parse_amount("1,000") == 1000.0

def test_cents_kept():
    assert parse_amount("$9.99") == 9.99
