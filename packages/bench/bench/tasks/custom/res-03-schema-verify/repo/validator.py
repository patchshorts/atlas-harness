"""Schema validator — checks presence only (types ignored, bug)."""
def validate(payload, schema):
    for field, spec in schema.items():
        if spec.get("required") and field not in payload:
            raise KeyError(field)
    return True
