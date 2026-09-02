Fix repo/ so all tests pass. The three services share the API client in
client.py. The client contract (documented in client.py) exposes get() and
post() ONLY. Every service must route through that contract. Do not modify
tests/.