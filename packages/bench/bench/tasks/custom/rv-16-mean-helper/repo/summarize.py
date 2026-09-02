"""Public mean wrapper."""
from metrics import mean


def summarize(values):
    return mean(values)