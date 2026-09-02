Trivial-turn bench micro-repo.

A trivial greeting turn requires no working tree. This directory exists only
so the bench sandbox seed resolves (taskDescriptor resolves micro_repo for
every custom task). The verifier ignores the tree entirely and gates on the
session log (assistant reply + zero tool calls).
