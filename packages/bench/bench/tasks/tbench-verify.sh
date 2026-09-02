#!/usr/bin/env bash
# tbench local verifier — bench gauntlet T8.
#
# Runs the pinned terminal-bench task's pytest suite against the agent's
# working environment after a session. $1 = the session sandbox dir; the
# session dir name IS the task id (e.g. terminal-bench/bun-sourcemap-leak),
# and the checkout layout maps that id to tasks/<id>/ (strip the
# "terminal-bench/" prefix). Tests live in the pinned checkout, not the
# sandbox; pytest fixtures resolve relative to the test files.
#
# Container-state tests (services, network) may fail locally — those
# failures are honest per-task data (taskSuccess=false), never silent.
set -u
sandbox="$1"
checkout="${TBENCH_CHECKOUT:-/tmp/tbench-probe}"
task_id="$(basename "$(dirname "$sandbox")")"
task_dir="$checkout/tasks/${task_id#terminal-bench/}"
work="$sandbox/environment"
[ -d "$work" ] || work="$sandbox"

if [ ! -d "$task_dir/tests" ]; then
  echo "tbench-verify: no tests dir at $task_dir" >&2
  exit 2
fi
if ! cd "$work"; then
  echo "tbench-verify: cannot cd to $work" >&2
  exit 2
fi

python3 -m pytest -q -p no:cacheprovider --disable-warnings --no-header "$task_dir/tests"
exit $?
