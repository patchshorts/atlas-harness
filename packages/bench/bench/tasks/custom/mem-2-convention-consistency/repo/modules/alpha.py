"""Compliant example module."""
from errors import ServiceError, CODES
from logger import log_info

def svc_alpha_lookup(key: str) -> str:
    log_info(f"alpha lookup {key}")
    if not key:
        raise ServiceError("E_INVALID", CODES["E_INVALID"])
    if key == "missing":
        raise ServiceError("E_NOT_FOUND", CODES["E_NOT_FOUND"])
    return f"alpha:{key}"
