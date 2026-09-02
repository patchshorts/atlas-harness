#!/usr/bin/env python3
"""Assemble the Acme marketing site into dist/index.html.

Reads the component partials and content/pricing.yml, composes the pricing
page, and emits a single static HTML file. Enforces the brand rule (BRAND.md)
that no literal colour value appears in rendered markup — the only sanctioned
home for colours is tokens.css.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
COMPONENTS = [
    "header.html",
    "hero.html",
    "promo-banner.html",
    "features.html",
    "pricing.html",
    "stats.html",
    "cta.html",
    "footer.html",
]

HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")


def read_partial(name):
    p = ROOT / "components" / name
    return p.read_text(encoding="utf-8") if p.exists() else ""


def parse_pricing(text):
    """Minimal, flat parser for the little pricing.yml subset in use."""
    title = subtitle = ""
    plans = []
    current = None
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        m = re.match(r"^title:\s*(.+)$", s)
        if m:
            title = m.group(1).strip().strip('"\'')
            continue
        m = re.match(r"^subtitle:\s*(.+)$", s)
        if m:
            subtitle = m.group(1).strip().strip('"\'')
            continue
        m = re.match(r"^- name:\s*(.+)$", s)
        if m:
            current = {"name": m.group(1).strip().strip('"\''), "features": []}
            plans.append(current)
            continue
        if current is None:
            continue
        m = re.match(r"^price:\s*(\d+)", s)
        if m:
            current["price"] = m.group(1)
            continue
        m = re.match(r"^interval:\s*(.+)$", s)
        if m:
            current["interval"] = m.group(1).strip().strip('"\'')
            continue
        m = re.match(r"^-\s+(.+)$", s)
        if m:
            current["features"].append(m.group(1).strip().strip('"\''))
    return title, subtitle, plans


def render_plans(plans):
    cards = []
    for p in plans:
        feats = "\n".join(f"      <li>{f}</li>" for f in p.get("features", []))
        price = p.get("price", "—")
        interval = p.get("interval", "month")
        cards.append(
            '    <div class="plan-card">\n'
            f'      <h3>{p["name"]}</h3>\n'
            f'      <div class="plan-price">${price}'
            f'<span class="plan-interval">/{interval}</span></div>\n'
            f"      <ul>\n{feats}\n      </ul>\n"
            "    </div>"
        )
    return "\n".join(cards)


def main():
    title, subtitle, plans = parse_pricing((ROOT / "content" / "pricing.yml").read_text())
    if not plans:
        sys.exit("build: no pricing plans parsed from content/pricing.yml")

    pricing = read_partial("pricing.html")
    pricing = pricing.replace("__TITLE__", title)
    pricing = pricing.replace("__SUBTITLE__", subtitle)
    pricing = pricing.replace("__PLANS__", render_plans(plans))

    body = "".join(read_partial(n) for n in COMPONENTS if n != "pricing.html")
    body += pricing

    html = (
        "<!doctype html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"  <title>{title}</title>\n"
        '  <link rel="stylesheet" href="tokens.css">\n'
        "</head>\n"
        f"<body>\n{body}\n</body>\n"
        "</html>\n"
    )

    # Brand rule: no literal colour in rendered markup.
    offending = [ln for ln in html.splitlines() if HEX.search(ln)]
    if offending:
        for ln in offending:
            print(f"BRAND VIOLATION — literal colour in markup: {ln.strip()}")
        sys.exit("build aborted: literal colour in markup (see BRAND.md)")

    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_text(html, encoding="utf-8")
    print(f"built dist/index.html ({len(plans)} pricing plans, {len(html)} bytes)")


if __name__ == "__main__":
    main()