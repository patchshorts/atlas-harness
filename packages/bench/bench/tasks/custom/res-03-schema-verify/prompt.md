Implement repo/validator.py so all tests pass. validate(payload, schema)
must check: every REQUIRED field is present, and every present field's value
has the type declared in the schema. Missing required field -> KeyError.
Type mismatch -> TypeError. Do not modify tests/.