# Running benchmarks

This repo carries a paired corrections benchmark: a vanilla DeepSeek Harness fork
(clone arm) versus this repo's additive Atlas build (additive arm), over a frozen
task suite defined in [bench-manifest.json](../bench-manifest.json). Tasks live in
`packages/bench/bench/tasks/custom/` (each: `prompt.md` + `repo/` micro-repo +
`verify.sh` deterministic verifier). The runner is `packages/bench/bench/src/run/cli.ts`.

## Prerequisites

- Node ^22.19 or >=24, pnpm workspaces installed (`pnpm install`)
- `DEEPSEEK_API_KEY` (or OpenRouter credentials via `DEEPSEEK_BASE_URL`) in the
  environment or root `.env`
- Two harness checkouts side by side: this repo (additive arm) and an unmodified
  DeepSeek Harness fork pinned at the vanilla base commit (clone arm). Both arms
  must run from a clean checkout at the intended commit.

## Run one arm

From the additive repo root:

```sh
node --import tsx/esm packages/bench/bench/src/run/cli.ts \
  --arm additive \
  --task crit-1-plan-follow \
  --task grn-02-quoted-csv \
  --harness /path/to/this-repo \
  --manifest bench-manifest.json \
  --output /path/to/bench-runs/<run-id> \
  --model deepseek-v4-flash \
  --max-tokens 8192
```

Omit `--task` to run the full manifest suite. `--arm clone` points
`--harness` at the vanilla fork checkout. Each task is one session: the CLI
writes the task prompt into the harness, tees session logs, and runs the task's
`verify.sh` (exit 0 = pass).

## Output layout

`<output>/` contains per arm:

- `session-logs/<arm>/` — per-session JSONL logs
- `counts-<arm>.json` — per-task corrections (C1..C5), success, waste-ratio summary
- `cost-<arm>.json` — per-task token and cost sidecar
- `run.log` — harness fingerprint, model pin, run chronology

Harbor resumes by job name; a changed job name forces a fresh run. A `0.0`
verdict with a missing `/app` artifact is a working-directory wiring bug, not a
capability result — check the task's artifact contract before attributing failure
to the model.

## Cost

At deepseek-v4-flash-0731 pricing (~$0.44/M input and output tokens), a full
paired manifest run costs roughly $4 total (~$0.03-$0.04 per task per arm). Scale
task counts accordingly.

## Reproducing the paper numbers

`docs/paper/data-appendix.md` is machine-generated from the clean paired run
`corr-g244-run2-20260825071455` (2026-08-25, 69 tasks, both arms same day).
Its raw artifacts — `counts-*.json`, `cost-*.json`, `run.log` — are committed
under [docs/paper/run-data/](paper/run-data/). Session logs (~206 MB) stay on the
operator machine and are not committed. The appendix generator is
`docs/paper/scripts/gen_waste_appendix.ts`; figures come from
`docs/paper/scripts/make_figures.py`.
