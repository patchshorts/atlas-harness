"""WARNING: this module VIOLATES the conventions. Do not copy its style."""
def score(items):
    print("scoring", len(items))          # violation: print()
    try:                                   # violation: bare except
        return len([x for x in items if x])
    except:
        return 0
