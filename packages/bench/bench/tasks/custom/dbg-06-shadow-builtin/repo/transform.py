"""Transforms an iterable into a list, with a module-level shadow bug."""
list = ["legacy", "export"]  # legacy.py imports this name

def to_list(iterable):
    return list(iterable)  # TypeError: 'list' object is not callable
