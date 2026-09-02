import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from report import render_header


def test_header_indent():
    assert render_header() == "    HDR"
def test_indent_direct():
    from indent import indent
    assert indent(0) == ""
    assert indent(1) == "  "