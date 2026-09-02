# dsh-tool-allowlist

Fail-closed tool-call allowlist gate (`ctx.guardToolAllowlist`): a `tools/execute` wrapper that rejects any tool name not on the configured allowlist with a structured denial and an auditable event, plus a PromptArmor-style post-execute sanitizer that neutralizes directive-like fragments in tool-result content. This is the **load-bearing in-band prompt-injection defense boundary** for the harness: instruction-like content disguised as tool output that would trigger an out-of-list tool call dies here, structurally, not in the prompt ([redesign plan D5](../../../.agents/notes/implemented/architecture/2026-07-29-package-regrouping.md); the prior workstream).

## Plugin (namespace: `tool-allowlist`)

A service package (default-exports the `ToolAllowlistService` class) that registers the `guardToolAllowlist` service on the Cordis context. Constructing the service arms a `tools/execute` listener; non-allowlisted calls are denied with a structured `TOOL_NOT_ALLOWLISTED` result before dispatch.

```yaml
- id: tool-allowlist
  name: '@atlasai/atsh-tool-allowlist'
  config:
    allowlist:
      - read
      - write
      - web_search
```

### Config (schemastery)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch. `false` bypasses the gate entirely — never a shipped default. |
| `allowlist` | `string[]` | `[]` | Tool names allowed to execute. **Empty list denies everything (fail-closed).** |
| `denyReason` | `string` | `tool "{name}" is not on the execution allowlist` | Model-facing deny message; `{name}` is replaced with the rejected tool name. |

A misspelled config key (e.g. `allowist`) throws at construction — fail loud, no silent fallback.

### Behavior

For each `tools/execute` event:

1. If the gate is disabled, delegates unchanged.
2. If the tool name is on the allowlist, delegates unchanged (allowlisted call passes).
3. Otherwise emits the auditable `guard/allowlist-deny` event with the rejected name, then returns a structured denial result: `{ isError: true, error: { message, info: { name: 'ToolNotAllowlistedError', code: 'TOOL_NOT_ALLOWLISTED' } }, content: 'Error: <denyReason>' }`.

The deny result carries a scoped `error.code` (`TOOL_NOT_ALLOWLISTED`) so retry/sandbox plugins and replay can route on it — the same shape as the guard `timeout-policy` denial. This is where the in-band injection class dies: a payload that tricks the model into calling `write` to exfiltrate is rejected at the tool boundary, not in the prompt.

### Sanitizer (`./sanitize`)

A pure, deterministic neutralizer (`neutralizeText` / `neutralizeContent`) that wraps directive-like fragments (imperative openings such as "ignore", "from now on", "pretend", "do not tell") in `[untrusted data: ...]` brackets, marking them as data rather than deletable orders. Benign content passes through unchanged. Wire it as a `tools/post-execute` wrapper via `applySanitizer(ctx, { enabled })` — defense in depth behind the allowlist.

## Composing with other `tools/execute` wrappers

Multiple `tools/execute` listeners compose by cordis registration order. The allowlist should be registered **outermost** so the gate runs before timeout/retry wrappers — a denied call never enters the timeout path. Composing with the sanitizer: allowlist gate first, sanitizer on post-execute.

## Guard-owned composition (how to enable the gate)

The gate is **opt-in**: no shipped default composition mounts it. A consumer
enables it by adding the `tool-allowlist` row to their own `cordis.yml`, with
an explicit allowlist (fail-closed — an empty `allowlist` denies every tool
call). `real-composition.spec.ts` boots this exact shape through the real
Loader and asserts the out-of-list denial.

```yaml
- name: '@atlasai/atsh-system-prompt'
- name: '@atlasai/atsh-tools'
- name: '@atlasai/atsh-tool-allowlist'
  config:
    allowlist:
      - read
      - write
      - web_search
    denyReason: 'tool "{name}" is not on the execution allowlist'
```

Wire the channel-marking prompt section (the sibling D5 layer that pins
`system > user > tool-result` and subordinates tool output) with its
registration helper from `@atlasai/atsh-agent-loop`'s `channel-marking`
module — see `channel-marking.spec.ts` (agent-loop FR-8). The two compose:
channel-marking tells the model tool output is subordinate DATA; the allowlist
gate makes an out-of-list call impossible to dispatch. Both stay out of shipped
defaults; consumers mount them together when they opt in to the defense.

## Model Experience

### Conditional tool result

#### What the model sees

This plugin adds no prompt and no schema. On an out-of-list call it replaces the provider's outcome with `Error: <denyReason>` plus structured `TOOL_NOT_ALLOWLISTED`; an allowlisted call passes through unchanged. When the sanitizer is armed, directive-like fragments in successful tool-result text are bracketed as untrusted data before reaching model context.

#### Token effect

Zero tokens on allowlisted calls. A denied call adds one small retained error result and prevents dispatch entirely.

#### KV Cache effect

Append-only; the deny result follows the reusable request prefix and does not invalidate existing KV-cache entries. Channel-marking and sanitizer behavior are stable across turns — nothing is per-turn randomized (prefix-cache byte stability).

## Known Limitations and Deferred Work

- **The tool gate is the defense, not the prompt.** In-band content is token-indistinguishable from truth; this package deliberately does not promise the model "fully resists." The guarantee is structural: an out-of-list tool call is impossible to dispatch.
- **Sanitizer is heuristic.** `neutralizeText` matches a fixed imperative-pattern set. It is a best-effort defense-in-depth pass, not a proof; the allowlist gate carries the load-bearing guarantee.
- **Allowlist is static per composition.** `allowlist` is read at construction; there is no runtime service-method to mutate it (an invariant-held set). Dynamic reconfiguration is deferred.
