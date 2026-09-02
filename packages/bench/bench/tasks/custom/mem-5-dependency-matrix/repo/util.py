"""Utility helpers — allowed only for modules listed in DEPENDENCIES.md."""
from core import normalize

def canonical_key(x):
    return "u:" + normalize(x)
