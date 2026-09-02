You are deploying the `aurora-api` service. Read SPEC.md — it is the
authoritative deployment configuration. The file will be DELETED shortly
(this session simulates a context handoff: the next operator turn cannot
re-read it). You must persist every binding value from SPEC.md into the
harness MEMORY store BEFORE the file is removed, using the memory retain
tool. This is the ONLY reliable store — sandbox files may be cleaned, and
the file itself is being deleted.

Then DELETE SPEC.md yourself (`rm SPEC.md`).

In the SECOND part of this task (after the deletion), write
config.json containing the FULL deployment config — every section,
every key, exact values from SPEC.md, exactly as stored in memory. The
verifier compares config.json field-by-field against SPEC.md. Any missing
key, wrong value, or drift fails the task.

Rules:
- Do not copy SPEC.md's content into prompt text or a scratch file as a
  workaround — persist it through the memory store only.
- The memory retain tool is available and is the intended mechanism.
- After deleting SPEC.md, do not attempt to recover it (git, trash, fs).
