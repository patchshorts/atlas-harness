Both parsers (parsers/v1.py and parsers/v2.py) fail the quoted-field edge case:
a quoted field at the END of the line (e.g. 'e5,"Quoted, End"') must parse to
{"id": "e5", "name": "Quoted, End"}. Fix v1.py, then apply the SAME fix to
v2.py — they are twins and must behave identically. Do not add files. All tests
in tests/ must pass.
