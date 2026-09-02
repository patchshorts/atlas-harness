"""Compliant example module."""
from errors import ServiceError, CODES
from logger import log_info

def svc_beta_score(items: list) -> int:
    log_info(f"beta scoring {len(items)} items")
    if not items:
        raise ServiceError("E_INVALID", CODES["E_INVALID"])
    return sum(1 for i in items if i > 0)
