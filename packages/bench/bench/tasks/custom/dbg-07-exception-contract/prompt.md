Fix repo/accounting.py so all tests pass. The public contract says
withdraw() raises KeyError when the account id is unknown (the current code
raises the wrong exception type). Do not modify tests/.