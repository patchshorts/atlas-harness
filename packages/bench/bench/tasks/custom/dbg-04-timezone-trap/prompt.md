Fix repo/timeutil.py so all tests pass. now_utc() must return an
aware datetime in UTC (never naive). The function must keep accepting a tz
parameter for callers that pass one. Do not modify tests/.