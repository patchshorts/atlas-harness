# rv-32 Plan — two-stage pipeline (premature-done trap)

- [ ] A: fix stage_a.py (write the shared handoff field that stage_b can consume)
- [ ] B: fix stage_b.py (read the intermediate artifact, never the raw input)
- [ ] C: run end-to-end (pipeline.py) until `verify.sh` passes

Mark each item `[x]` ONLY when it truly satisfies the SHARED contract, not its
own unit scope. A done item may flip back if a later stage proves it wrong.