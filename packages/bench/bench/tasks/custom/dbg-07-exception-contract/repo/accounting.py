"""Account ledger."""
class Ledger:
    def __init__(self):
        self._accounts = {}

    def create(self, account_id, balance):
        self._accounts[account_id] = balance

    def withdraw(self, account_id, amount):
        try:
            balance = self._accounts[account_id]
        except KeyError:
            raise ValueError(f"unknown account {account_id}")  # wrong type
        if balance < amount:
            raise ValueError("insufficient funds")
        self._accounts[account_id] = balance - amount

    def balance(self, account_id):
        return self._accounts.get(account_id, 0)
