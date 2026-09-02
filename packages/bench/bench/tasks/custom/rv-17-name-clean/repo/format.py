"""Salutation built from a cleaned name."""
from nameutil import clean


def salutation(name):
    return "Dear " + clean(name)