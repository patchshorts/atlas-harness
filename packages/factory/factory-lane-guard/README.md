# @atlasai/atsh-factory-lane-guard

Fix 12/6 lane separation + injection defense (`ctx.laneGuard`): channel-based
instruction marking (system > tool output), a tool-call allowlist at the
harness boundary, a PromptArmor-pattern sanitization pass, and taint-aware
verification for the in-band class. The package never mutates the session log
or message history — every pass returns NEW derived values (golden rule).

## Model Experience

- **Zero model calls in the deterministic core.** `defend()`, the allowlist
  gate, `markChannels()`, `sanitize()`, and `verifyComposed()` are pure
  deterministic functions — no LLM, no network, no token spend. The taint
  verifier's extraction heuristic stands in for what is a model pass in
  production; the verifier operates on whatever triples were extracted.
- **Token effects.** None from this package itself. A caller that wires the
  sanitize pass pre-context reduces the tokens the model sees (stripped text
  never enters context); nothing here rewrites the session log or
  projections.
- **KV-cache effects.** None. The package holds no model-visible state and
  never writes to message history.

## Install and mount

```ts
import LaneGuardService from '@atlasai/atsh-factory-lane-guard'

ctx.plugin(LaneGuardService, {
  allow: ['search', 'web_search', 'read_file'], // non-empty => default-deny everything else
  deny: [],                                     // deny wins over allow
  sanitize: true,                               // default: enable the strip pass
  taint: true,                                  // default: enable taint verification
})
```

The service registers ONE runtime effect: the tool-call allowlist guard
against the tools guard layer, read optionally via `ctx.get('tools')` (never
`ctx.tools` — topology-sensitive proxy). When no tools service is mounted
the service is passive. Everything else is pure derived passes + public
service methods.

## Config

| key | type | default | description |
| --- | ---- | ------- | ----------- |
| `enabled` | `boolean` | `true` | when false the service is passive: no guard registered, gate methods throw `lane-guard disabled`, sanitize returns the input untouched |
| `allow` | `string[]` | `[]` | glob patterns (exact or `*`-suffixed prefix match); non-empty => default-deny everything else |
| `deny` | `string[]` | `[]` | deny wins over allow |
| `sanitize` | `boolean` | `true` | false disables the sanitize pass (passive identity) |
| `taint` | `boolean` | `true` | false disables taint verification (passive verdict) |

## Events

| event | payload | description |
| ----- | ------- | ----------- |
| `lane/veto` | `LaneVetoRecord` | a tool call was denied by the allowlist gate (`name`, `reason`, `ts`) |

## The 22-payload fixture

`tests/fixtures/injection-payloads.ts` reproduces the empirical Pass 6
result (kgraph, 2026-08-17): **19/22 resisted at the tool gate** — class 1
explicit instruction attacks (9), class 2 tool-call directives (5), class 3
in-band variants + marker spoofs (8). `defend()` resists via the sanitize
pass (marker / spoof / encoded-blob strips) or the allowlist gate; the exact
3 non-resistant payloads (`in-band-summary`, `in-band-fact`, `in-band-lie`)
are the documented in-band ceiling — pure-content payloads with no directed
tool that the harness boundary cannot see.

## Known Limitations and Deferred Work

- **The in-band ceiling is not caught by the gate.** Pure-content in-band
  payloads with no directed tool (`in-band-summary`, `in-band-fact`,
  `in-band-lie`) are not resisted by `defend()`. Taint verification and
  output validation are the model-level defenses; this package exposes them
  (`verifyComposed`, `toTriples`) but does not wire them.
- **Sanitization is a deterministic approximation of PromptArmor, not a
  model-backed classifier.** The marker list is conservative; novel phrasing
  escapes it, and legitimate text can false-positive on a marker phrase.
- **The gate is a harness-boundary defense.** Caller wiring applies the
  sanitize pass pre-context; this package proves the pass, it does not
  install it into the prompt pipeline.
- **The taint extractor is a heuristic.** The real extraction is a model
  pass; the heuristic keeps the deterministic test suite self-contained.

## Golden rule

Never writes to the session log or message history — append-only held.
Channel marking, sanitization, and taint verification are derived passes
over copies that return NEW arrays/strings; inputs stay byte-identical
(asserted in the package's tests).
