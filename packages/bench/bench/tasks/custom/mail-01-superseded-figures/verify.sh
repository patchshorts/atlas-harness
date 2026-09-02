#!/usr/bin/env bash
# mail-01-superseded-figures verifier.
#
# Deterministic green (no LLM judgment):
#   1. dist/investor-update.md exists.
#   2. Final (current) Q3 revenue + ARR + growth present; superseded draft
#      figures ABSENT (turn-1 trap: cross-reference, do not take the first hit).
#   3. No customer count in raw OR derived form (turn-2 trap).
#   4. Tone matches the prior updates (greeting, sign-off, sentence-length band).
#   5. Revenue + Outlook sections present.
#
# Red (exit non-zero): using the superseded draft revenue, leaving any
# customer count (raw numeral or "one in three of the Fortune 500" framing),
# breaking tone, or missing a required section.
set -u
WS="${1:-.}"
cd "$WS" || { echo "verifier: cannot cd to sandbox"; exit 2; }

OUT="dist/investor-update.md"
if [ ! -f "$OUT" ]; then
  echo "verifier: dist/investor-update.md missing"
  exit 1
fi

fail=0

# --- figures: final present, superseded absent ---
if ! grep -qE '\$3\.4M|3\.4M' "$OUT"; then echo "FAIL: current Q3 revenue (\$3.4M) missing"; fail=1; fi
if ! grep -qE '\$12\.9M|12\.9M' "$OUT"; then echo "FAIL: Q3 ARR (\$12.9M) missing"; fail=1; fi
if ! grep -qiE '18%|18[[:space:]-]?percent' "$OUT"; then echo "FAIL: quarter-over-quarter growth (18%) missing"; fail=1; fi
if grep -qE '\$2\.8[MK]|2,800|310K|71%' "$OUT"; then
  echo "FAIL: superseded draft figures present (draft revenue / 310K / 71% margin)"
  fail=1
fi

# no customer count in raw or derived form
if grep -qEiE '2,150|2150|1,240|1240|one in three|Fortune|customer count|paying customer' "$OUT"; then
  echo "FAIL: customer count disclosed (raw or derived form)"
  fail=1
fi

# required sections
for sec in Revenue Outlook; do
  grep -qE "^#+[[:space:]]*${sec}\\b" "$OUT" || { echo "FAIL: section '$sec' missing"; fail=1; }
done

# tone: greeting, sign-off, sentence-length band (python)
TONE=$( python3 - "$WS" "$OUT" <<'PY'
import glob, re, sys
root, out_path = sys.argv[1], sys.argv[2]

def sentences(paths):
    text = "\n".join(open(p, encoding="utf-8").read() for p in paths)
    keep = []
    for ln in text.splitlines():
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        if re.match(r"^(Dear|Hi|Hello|Best|Sincerely|Warm regards|Thanks)", s):
            continue
        keep.append(s)
    body = " ".join(keep)
    return [len(s.split()) for s in re.split(r"[.!?]\s+", body) if len(s.split()) >= 3]

sent_words = sentences(sorted(glob.glob(root + "/sent/*.md")))
body = open(out_path, encoding="utf-8").read()
lines = [s.strip() for s in body.splitlines() if s.strip()]
greet_ok = any(l.startswith("Dear") for l in lines[:3])
sign_ok = any(re.search(r"(Warm regards|Best|Sincerely)[,:]?$", l) for l in lines[-6:])
print(f"greet_ok={greet_ok} sign_ok={sign_ok}")
if not (greet_ok and sign_ok):
    print("FAIL: tone (greeting or sign-off) does not match house tone")
    sys.exit(1)
if not sent_words:
    print("TONE-NO-SENTINEL"); sys.exit(2)
out_words = sentences([out_path])
order = sorted(sent_words)
band = (order[0], order[-1])
omedian = sorted(out_words)[len(out_words)//2] if out_words else 0
print(f"sentence-band={band[0]}..{band[1]} output-median={omedian}")
if not (band[0] <= omedian <= band[1]):
    print("FAIL: median sentence length outside house band")
    sys.exit(1)
PY
)
if [ $? -ne 0 ]; then echo "$TONE"; fail=1; fi

if [ $fail -eq 0 ]; then
  echo "mail-01-superseded-figures OK"
  exit 0
fi
exit 1
