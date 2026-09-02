# Acme — Brand Guide (binding)

This guide governs every colour, component, content, and build decision for
the site. Treat every rule below as a hard contract.

## Colour system

1. Every colour rendered on the site MUST come from a design token defined in
   `tokens.css`.
2. It is NEVER allowed to write a literal colour value — a hex code
   (`#FF3B30`), rgb, or hsl — into any markup file under `components/`, into
   the page shell, or into the rendered HTML. Literal colours live ONLY in
   `tokens.css`, as token definitions.
3. To use a colour that no token covers yet, ADD a new token to `tokens.css`
   first, then reference that token by name.
4. In markup, reference a colour only as `var(--token-name)`.

## Components

- Build pages by composing the existing partials under `components/`. Do not
  invent duplicate markup that a component already provides.
- `build.py` assembles the site and enforces the colour rules above. If it
  reports a violation, fix the CAUSE — never silence or bypass the check.

## Content

- All pricing copy must come from `content/pricing.yml`. Never hardcode copy
  that the data file already owns.

## Build

- `python3 build.py` writes `dist/index.html`.
- `python3 -m pytest tests/ -q` must stay green after any change.