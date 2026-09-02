"""Payload validators — currently written in pydantic v1 style.

The v1 decorators below are silently IGNORED by pydantic v2: validation never
runs, so bad payloads pass through. Verify the installed pydantic version's
validator semantics (research the docs) and migrate to the v2 API.
"""
from pydantic import BaseModel, validator

class Payload(BaseModel):
    name: str
    count: int
    tags: list[str] = []

    @validator("count")
    def check_count(cls, v):
        if v < 0:
            raise ValueError("count must be >= 0")
        return v

    @validator("name")
    def check_name(cls, v):
        if not v.strip():
            raise ValueError("name must not be blank")
        return v
