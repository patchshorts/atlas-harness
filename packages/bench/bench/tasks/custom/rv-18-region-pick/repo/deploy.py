"""Default deploy region."""
from registry import pick


def default_region():
    return pick()