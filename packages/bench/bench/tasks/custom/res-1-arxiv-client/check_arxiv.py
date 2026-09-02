"""Verify the client against the full fixture (not visible to the agent)."""
import json, pathlib, sys

sys.path.insert(0, ".")
import arxiv_client

fixture = pathlib.Path("fixtures/full_sample.xml")
if not fixture.exists():
    fixture = pathlib.Path(sys.argv[1])
out = arxiv_client.fetch_recent("cs.AI", 10, source=str(fixture))
assert isinstance(out, list) and len(out) == 2, out
one = out[0]
assert one["id"] == "http://arxiv.org/abs/2401.00001v1", one
assert one["title"] == "Example paper one", one
assert one["authors"] == ["Alice Example", "Bob Example"], one
assert one["published"] == "2024-01-01T00:00:00Z", one
two = out[1]
assert two["authors"] == [], two  # missing author -> empty list, not crash
print("ARXIV-OK")
