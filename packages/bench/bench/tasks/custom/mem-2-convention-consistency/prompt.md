Implement three new modules in modules/ — gamma.py, delta.py, epsilon.py — that
follow CONVENTIONS.md EXACTLY:
1. Function names prefixed `svc_`.
2. Failures the module raises use ServiceError with a code from errors.py.
   (Python interpreter blocking errors — arg-binding TypeError, import,
   compile errors — occur before module code runs and are not module faults.)
3. Logging via logger.py; no print().
4. No bare except.
5. Imports: stdlib, logger, errors only.
Each module: one function (svc_gamma_summarize, svc_delta_validate, svc_epsilon_merge)
operating on simple dict/list inputs. modules/bad_example.py does NOT follow the
conventions — do not copy it. No new dependencies.
