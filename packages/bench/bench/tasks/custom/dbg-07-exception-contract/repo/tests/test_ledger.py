import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from accounting import Ledger

def test_withdraw_ok():
    l = Ledger(); l.create("a", 100); l.withdraw("a", 40)
    assert l.balance("a") == 60

def test_unknown_account_raises_keyerror():
    l = Ledger()
    with pytest.raises(KeyError):
        l.withdraw("nope", 1)

def test_insufficient_raises():
    l = Ledger(); l.create("a", 5)
    with pytest.raises(ValueError):
        l.withdraw("a", 10)
