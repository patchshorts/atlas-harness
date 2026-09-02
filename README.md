# Atlas Harness

English | [中文](README.zh.md)

**Atlas Harness** is an additive agent capability harness built on the DeepSeek Harness foundation and the Cordis plugin spine. It is authored and maintained by **Christopher Shaun Godwin**, an independent AI researcher.

It uses an architecture where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## What Atlas adds

This repository is a fork of DeepSeek Harness with **additive changes only**. Upstream is pinned at commit `47f943859b` (v0.1.0-rc.5, MIT). Tracking and the change log live in [UPSTREAM.md](UPSTREAM.md); upstream files are frozen and verified against [FROZEN_FILES.sha256](FROZEN_FILES.sha256). No upstream file is modified.

### Additive packages

- `packages/skill/skill-corpus` — `@atlasai/atsh-skill-corpus`: 22 Atlas AI-authored SKILL.md files as a skill corpus (ctx.skills)
- `packages/memory` — `@atlasai/atsh-memory` + `@atlasai/atsh-tool-memory`: semantic memory store (ctx.memoryStore) with memory_recall / memory_retain / memory_reflect tools
- `packages/router` — `@atlasai/atsh-router` + `@atlasai/atsh-router-trainer`: LLM call router with persisted call log (ctx.llmRouter, ctx.routerTrainer)
- `packages/cache` — `@atlasai/atsh-cache`: LLM response cache (ctx.llmCache)
- `packages/kgraph` — `@atlasai/atsh-kgraph` + `@atlasai/atsh-tool-kgraph`: OKR knowledge graph (ctx.kgraph) with kgraph_upsert_objective / kgraph_record_evidence / kgraph_query tools
- `packages/accounting` — `@atlasai/atsh-accounting`: token ledger with credit grants and budget caps (ctx.accounting)
- `packages/coordination` — `@atlasai/atsh-coordination`: worker coordination over the subagent registry (ctx.coordination)
- `packages/research` — `@atlasai/atsh-research` + `@atlasai/atsh-tool-research`: xurl and arXiv search tools (ctx.research)
- `packages/factory` — `@atlasai/atsh-factory` + `@atlasai/atsh-tool-factory`: plan contracts and BAR critic (ctx.factory) with bar_critic / contract_status tools

### Additive packages — Model Experience

The additive packages change model, token, and provider-cache behavior. The largest effect is the default context reducer, prompt-lume (`@atlasai/atsh-prompt-lume`, part of the `packages/prompt/` group). On every primed turn it distills the working intent, retrieves the most-germane corpus chunks, re-ranks them, and injects a provenance-labeled task-aligned region **after** a byte-stable cached core. Four reduction grades — `low`, `med`, `high`, `xhigh` — drive the hook width. See the [hook-width reduction grade table](docs/prompt-lume.md#reduction-grades-hook-width-table) for the precise per-grade rows and the measured trivial-turn token-in progression. The summary Model Experience follows.

#### What the model sees

Per primed turn the model's system prompt is a byte-stable core (harness identity, persona, capability grammar — injected once, identical for the whole session) followed by a task-aligned region of provenance-labeled, most-germane corpus chunks selected by the resolved hook width. A chunk with no primed turn or an empty intent yields core only, with no injected region. The selected chunk count and region bytes depend on the grade's hook-width row.

#### Token effect

The region is the only per-turn-varying token content; its byte budget (`budgetBytes`, one of 8192 / 4096 / 2048 / 512 per grade) bounds it. The stable core contributes a fixed token count. Measured trivial-turn input descends monotonically with the grade (761 → 394 → 210 → 87 tokens for `low` → `med` → `high` → `xhigh`); every grade still sits behind a finite wall — there is no zero-commit grade.

#### KV Cache effect

The byte-stable core is a stable repeated prefix for the provider prompt-cache read: as long as the core bytes do not change, the cache read applies to it across turns. Grade switches, compaction, and per-turn renders touch only the region path; they never rewrite the core, so the cached prefix survives the whole session. Any drift in the core bytes invalidates the cache read for that turn — the package keeps the core byte-identical by construction.

## Research

The measured axes of this additive layer are documented in the paper, _What Actually Moves: Five Measured Axes of an Additive Agent Harness_ ([Markdown](docs/paper/paper.md) · [LaTeX](docs/paper/paper.tex) · [PDF](docs/paper/paper.pdf)), with the full source, figures, and typeset PDF archived under `docs/paper/` in this repository. Reproduction pins, raw per-session artifacts, and the reducer-grade sweep data are documented in the paper's data appendix.

## Quickstart

```sh
git clone https://github.com/patchshorts/atlas-harness.git
cd atlas-harness
pnpm install
pnpm run build
pnpm atsh web
```

To run a single task from source (additive modules composed on the host plane):

```sh
pnpm atsh --profile headless "your task"
```

Real LLM calls require a `DEEPSEEK_API_KEY` in the root `.env`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
