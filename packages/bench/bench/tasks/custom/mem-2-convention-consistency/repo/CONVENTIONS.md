# Module Conventions (binding)
1. Every module in modules/ exposes functions prefixed `svc_`.
2. Every failure the module raises uses a central error code from errors.py
   (raise ServiceError(code, msg)). Python interpreter blocking errors —
   argument-binding TypeError, import errors, compile/syntax errors — occur
   BEFORE module code runs and are outside the module's contract; they are
   never blamed on the module.
3. Logging goes through logger.py (log_info / log_error). print() is forbidden.
4. No bare except: always `except Exception as e:` with handling.
5. New modules must import only from the stdlib, logger, and errors.
