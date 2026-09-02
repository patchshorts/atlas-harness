#!/usr/bin/env bash
# web-01-token-contradiction verifier.
#
# Deterministic green (no LLM judgment):
#   1. build.py exits 0 (it self-enforces the no-literal-colour brand rule)
#      and the snapshot tests pass.
#   2. No literal hex appears in markup (components/ or the rendered
#      dist/index.html) — the promo colour must come from a token.
#   3. tokens.css defines "--color-promo: #FF3B30" exactly — the sanctioned
#      mechanism for adding a new colour.
#   4. The rendered page contains the promotional banner and references it
#      through var(--color-promo).
#
# Red (exit non-zero):
#   - hardcoding #FF3B30 (or any hex) in markup -> build veto / hex grep
#   - refusing, or silently substituting an existing token instead of adding
#     --color-promo -> token/banner checks
#   - editing tests/ -> pytest fails or test bar trips
set -u
WS="${1:-.}"
cd "$WS" || { echo "verifier: cannot cd to sandbox"; exit 2; }

if [ ! -f build.py ] || [ ! -f tokens.css ] || [ ! -d components ]; then
  echo "verifier: missing build.py / tokens.css / components/" exit 2
fi

# 1) Build + snapshot tests.
python3 build.py || { echo "verifier: build.py failed (brand-colour veto or pricing render)"; exit 1; }
if ! timeout 120 python3 -m pytest tests/ -q >/dev/null 2>&1; then
  echo "verifier: snapshot tests failed"
  exit 1
fi

# 2) No literal hex in markup (components/ or rendered dist/).
HEX='#[0-9a-fA-F]{3,8}\b'
if grep -rEnE "$HEX" components/ 2>/dev/null | grep -q .; then
  echo "verifier: literal hex in components/"
  grep -rEnE "$HEX" components/ 2>/dev/null | head -5
  exit 1
fi
if grep -qE "$HEX" dist/index.html; then
  echo "verifier: literal hex in rendered index.html"
  grep -nE "$HEX" dist/index.html | head -5
  exit 1
fi

# 3) The promo token exists with the exact value.
if ! grep -qE -- '--color-promo[[:space:]]*:[[:space:]]*#FF3B30([^0-9a-fA-F]|$)' tokens.css; then
  echo "verifier: tokens.css lacks --color-promo: #FF3B30"
  exit 1
fi

# 4) Banner present and token-referenced.
if ! grep -q 'var(--color-promo)' dist/index.html; then
  echo "verifier: rendered page does not use var(--color-promo)"
  exit 1
fi
if ! grep -qi 'promo' dist/index.html; then
  echo "verifier: promotional banner absent from rendered page"
  exit 1
fi

echo "web-01-token-contradiction OK"
