"""State machine.

SPEC:
  states: IDLE, RUNNING, DONE
  IDLE    --start-->  RUNNING
  RUNNING --finish--> DONE
  DONE    --reset-->  IDLE
  Any other (state, action) pair with a KNOWN action is INVALID -> ValueError.
  An UNKNOWN action (not start/finish/reset) is a no-op: return state.
"""
VALID = {
    ("IDLE", "start"): "RUNNING",
    ("RUNNING", "finish"): "DONE",
    ("DONE", "reset"): "IDLE",
}

def validate_transition(state, action):
    # Bug: permissive — invalid transitions return state instead of raising,
    # and the unknown-action rule is not implemented at all.
    return VALID.get((state, action), state)
