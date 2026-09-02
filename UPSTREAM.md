# Upstream — DeepSeek Harness

This repository is a fork of the DeepSeek Harness with **additive changes only**.
The upstream spine is cloned byte-faithful at a pinned commit; every Atlas
capability added on top is a plugin/preset/config extension. No cloned
behavior is rewritten.

## Pin

| Field | Value |
|---|---|
| Upstream repo | https://github.com/deepseek-ai/deepseek-harness |
| License | MIT (LICENSE kept; THIRD_PARTY_NOTICES.md kept) |
| Upstream version | v0.1.0-rc.5 |
| Default branch (upstream) | master |
| Pinned commit | `47f943859bef60e4160492346772ded9b24f765a` |
| Pinned (short) | `47f943859b` |
| Clone date | 2026-08-15 (tick 2 of the fork-creation workstream) |
| Node engine | ^22.19.0 \|\| >=24.0.0 (verified v22.22.2 on WSL) |

## Change log

Keep this log exhaustive — every divergence from upstream must be listed, one
numbered entry per change, in the same discipline as the upstream 18-entry
Cordis change log (`vendor/README.md#Local-modifications`): what was copied,
what we changed, why.

1. **Fork baseline (copied scope)** — copied the full upstream monorepo at the
   pinned commit above: `vendor/cordis` (+ vendored cosmokit/group/hmr/include/
   loader/schemastery/timer), `packages/` (core, session, compaction, preset,
   and all capability packages), `apps/`, `docs/`, `examples/`, `python/`,
   `native/`, `.agents/notes` (design-memo discipline preserved), LICENSE,
   THIRD_PARTY_NOTICES.md, and the upstream `.gitlab-ci.yml` (copied at
   baseline, since removed — see entry 7; GitHub Actions under
   `.github/workflows/` is the CI of record).
   Removed the upstream `.git` history (replaced by this fork's own git).
   Rationale: the fork directive — publish the harness to the public repo
   (`https://github.com/patchshorts/atlas-harness`) and make additive changes
   only. The frozen
   upstream spine stays byte-identical; `T5`/`T16` of the factory plan verify
   that with a sha256 manifest.
2. **Atlas additive packages (T6-T14)** — nine new workspace packages added
   under `packages/`: skill-corpus (`packages/skill/skill-corpus`, 208
   flattened SKILL.md files), memory (`packages/memory/{memory,tool-memory}`,
   `ctx.memoryStore` with SQLite default + pgvector backend, memory recall/
   retain/reflect tools), router (`packages/router/{router,trainer}`,
   `ctx.llmRouter` capability-gated llm/stream interception + `ctx.routerTrainer`
   training sink), cache (`packages/cache/cache`, `ctx.llmCache` exact-hash +
   semantic tiers), kgraph (`packages/kgraph/{kgraph,tool-kgraph}`,
   `ctx.kgraph` OKR model + autobuilder + tools), accounting
   (`packages/accounting/accounting`, `ctx.accounting` ledger/credits/budget
   caps), coordination (`packages/coordination/coordination`, `ctx.coordination`
   C2 over the existing subagent registry), research
   (`packages/research/{research,tool-research}`, `ctx.research` xurl + arXiv
   tools), factory (`packages/factory/{factory,tool-factory}`, `ctx.factory`
   plan-contract registry + BAR critic + role objectives, `bar_critic` /
   `contract_status` tools). All are ADDED packages and rows — no cloned file
   was rewritten (frozen manifest proof: `FROZEN_FILES.sha256`). Rationale:
   fork directive — port Atlas capabilities as additive modules per the
   additive inventory.
3. **Composition rows (T15)** — host-plane SERVICE rows for the nine additive
   families appended to `packages/bundle/base/cordis.patch.yml`; tool rows
   (tool-memory, tool-kgraph, tool-research, tool-factory) appended to
   `apps/cli/config/agent-presets/standard/agent.cordis.yml`; settings config
   rows (`router.enabled`, `cache.enabled`, `accounting.credits`). The
   interceptor services (router/cache/accounting) MUST live on the host plane —
   Cordis `dispatch()` reads only the emitting context's own hooks, so
   child-preset listeners are silently inert. Existing preset rows byte-identical
   (diff = 101 insertions, 0 deletions). Rationale: additive composition per
   inventory §2.4/§2.5.
4. **Generated catalogs + doc gates (T17 compliance)** — additive service/tool
   entries regenerated into `docs/tool-catalog.md` (+zh), a new subsystem page
   pair `docs/subsystems/atlas-additions.md` (+zh), `gen-cordis-api` catalog
   additions, `verify-export-jsdoc` coverage, and 13 README translation pairs
   with `.i18n.yaml` records. One frozen-root deviation, recorded:
   `packages/core/tools/tests/gen-tool-catalog.spec.ts` expected tool list
   grew 52→62 names (the 10 additive tools are shipped tool packages, so the
   catalog completeness guard forces them into the boot manifest; the fixture
   is the upstream test oracle for exactly that list) — its `FROZEN_FILES.sha256`
   entry was re-hashed accordingly (T17, M5.2 test reconciliation: the test is
   extended, never removed). Rationale: upstream doc gates must stay green
   while the shipped tool/service surface grows additively.
5. **Live proof + quickstart correction (T21)** — one-shot CLI task verified live:
   `pnpm atsh --profile headless "task"` (the shipped headless profile = dsh-base
   + dsh-headless; there is NO `standard` CLI profile — the standard name is an
   AGENT preset composed by the web profile and the CLI's agent-presets roster).
   The additive host-plane services ride along on every profile; the additive
   TOOL rows (tool-memory, tool-kgraph, tool-research, tool-factory) live in the
   standard preset composition, which the headless driver does not mount (its
   contract: model-facing rows on the global layer) — for headless one-shot
   runs the rows are supplied by a `--patch` overlay, or by the web app's
   standard preset. The README quickstart previously documented the nonexistent
   `--profile standard`; corrected to `--profile headless` in both languages
   (README.i18n.yaml re-recorded). Proof evidence: append-only session log
   (`~/.atsh/sessions/.../session.jsonl.zstd`) shows 4 tool calls
   (memory_retain/recall, kgraph_upsert_objective/query) with success results
   and the model reply `PROOF-OK` (exit 0). Rationale: the delivered quickstart
   must run; the one-shot surface is the headless profile, and the standard
   preset's additive tools compose through the web agent.
6. **Atlas fork release marker (exit wave)** — root `package.json` version
   bumped from `0.1.0-rc.5` to `0.1.0-rc.5-atlas.1` (the private root workspace
   manifest only; no dependency resolution changes, no frozen-root file
   touched). The bump marks the first Atlas fork release consumed by the
   benchmark and paper workstreams and gives the deploy pipeline a
   distinct, watchable merge commit on main. Rationale: release discipline —
   upstream versions stay identifiable (the `-atlas.1` suffix names the fork),
   and the exit wave's MR→approve→merge→deploy sequence (release gate of the
   factory plan) lands a real change on the prod trunk instead of a no-op MR.
7. **CI gate ran the test suite as a non-root user (M5.4 root-cause fix; now
   historical)** — the Atlas `.gitlab-ci.yml` `atlas-test` job previously ran
   `pnpm run test` as root (the private GitLab docker executor, runner 13
   `privileged=true`, has no user override). The upstream suite contains
   permission-semantics tests
   (sqlite-backend `chmod 0o500` expect-reject, out-of-process `chmod 0o600`
   expect-throw, bash-sandbox `chmod 0o555` expect-nonzero-exit, settings-file
   ×2, agent-instructions, subagent-acp cwd) that fail deterministically under
   root, because root bypasses file permission bits. Upstream GitHub CI runs
   on non-root runners, so the suite assumes a non-root user. Fix: the job
   chowns the workspace + pnpm store to the image's `node` user and executes
   the suite via `su node` (install stays root; chown happens after install so
   node_modules + the store are readable/writable by `node`; git
   dubious-ownership guard satisfied). Also adds `retry: max 1 when
   script_failure` for the documented load-timeout flake class
   (oxlint-contract, code-block.client — T17: pass in isolation 28/28 and in
   serial run 3). No test removed or weakened; frozen-root files untouched.
   Rationale: CI must exercise the suite in an environment matching upstream's
   non-root assumption, and the flake class is proven environmental, not a
   product defect. Superseded: the private GitLab runner infra and
   `.gitlab-ci.yml` were removed — GitHub Actions under `.github/workflows/`
   (non-root hosted runners) is the CI of record; the macOS deployment-target
   check stays covered by `scripts/check-macos-deployment-target.py`, wired
   into the GitHub wheel pipeline (`python-release.yml` →
   `build-exe-for-python-sdk.yml`).
