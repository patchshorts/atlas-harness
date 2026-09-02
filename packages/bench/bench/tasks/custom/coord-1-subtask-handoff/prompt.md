Complete the two subtasks in pipeline.py and the handoff between them:
Subtask A is implemented (normalize()); Subtask B (summarize) must read the
handoff artifact data/normalized.csv — never raw.csv — and write
data/summary.json with per-code summed amounts. The handoff artifact is the
contract: subtask B depends on subtask A's output, not on the input. Run
`python3 pipeline.py` end-to-end; it must be idempotent (running twice yields
the same files).
