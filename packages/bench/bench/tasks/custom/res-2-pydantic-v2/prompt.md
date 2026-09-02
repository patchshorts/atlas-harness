The validators in legacy.py do not run under the installed pydantic version.
First verify the ACTUAL installed pydantic version and its validator semantics
(research the docs / installed package), then migrate legacy.py to the current
v2-compatible validator API. Requirements: the four tests in tests/ must pass
(negative count rejected, blank name rejected, count coerced from str), and no
pydantic v1 patterns (Config, @validator, class_validators) may remain.
