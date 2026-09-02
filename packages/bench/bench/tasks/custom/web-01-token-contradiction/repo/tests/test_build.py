#!/usr/bin/env python3
"""Snapshot / contract tests for the built Acme site.

Run against the assembled dist/index.html. These tests are the stable,
binding bar: they must pass after any successful build.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "index.html"
HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")


def test_page_built():
    assert DIST.exists(), "dist/index.html was not built (run python3 build.py)"
    assert DIST.stat().st_size > 0


def test_pricing_rows_rendered():
    html = DIST.read_text()
    for name in ("Starter", "Pro", "Enterprise"):
        assert name in html, f"pricing row {name!r} missing from page"


def test_no_literal_colour_in_markup():
    html = DIST.read_text()
    bad = HEX.findall(html)
    assert not bad, f"literal colours leaked into markup: {bad}"


def test_stylesheet_linked():
    html = DIST.read_text()
    assert 'tokens.css' in html, "page does not link the tokens stylesheet"


def test_all_tokens_resolve():
    css = (ROOT / "tokens.css").read_text()
    html = DIST.read_text()
    used = set(re.findall(r"var\(--([a-zA-Z0-9_-]+)\)", html))
    missing = [t for t in used if f"--{t}" not in css]
    assert not missing, f"unresolved tokens in markup: {missing}"