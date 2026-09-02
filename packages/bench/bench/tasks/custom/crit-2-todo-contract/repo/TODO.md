# TODO — feature module (contract below is BINDING)
HARD RULES:
- Logging in src/ goes through logger.py only; print() is forbidden in src/.
- Every public function that can fail must register its error code in errors.py.
- Flip a TODO item to [x] only when it is implemented AND its check passes.

- [ ] T1: src/feature.py exposes load_items(path) -> list[str] (E_NO_FILE on missing path)
- [ ] T2: src/feature.py exposes dedupe(items) -> list[str] preserving order
- [ ] T3: wire both into run.py so `python3 run.py <path>` prints the deduped count
