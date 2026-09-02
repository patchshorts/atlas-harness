Implement repo/machine.py so all tests pass. validate_transition(state,
action) returns the next state per the SPEC in machine.py, raises ValueError
for INVALID transitions, and treats UNKNOWN actions as a no-op (returns the
state unchanged). Do not modify tests/.