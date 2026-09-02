import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline import aggregate, filter, format, ingest, normalize


def test_ingest_keeps_dash_ids():
    """Bug 1: the id regex must accept ids containing dashes."""
    recs = ingest("acct-7|12.5|active\nplain|3|inactive\n")
    ids = [r["id"] for r in recs]
    assert "acct-7" in ids, f"dash id dropped: {ids}"
    assert "plain" in ids


def test_ingest_skips_malformed_without_raise():
    """Malformed lines are skipped and logged, never raise."""
    import pipeline

    pipeline.WARNINGS.clear()
    recs = ingest("good|1.5|active\nnot-a-valid-line\n")
    assert len(recs) == 1
    assert len(pipeline.WARNINGS) == 1


def test_normalize_strips_value():
    """Bug 2: normalize must strip whitespace from value (check vs output)."""
    recs = normalize([{"id": "a", "value": "  10.5  ", "status": "ACTIVE"}])
    assert recs[0]["value"] == "10.5", f"value not stripped: {recs[0]['value']!r}"


def test_normalize_lowercases_status():
    recs = normalize([{"id": "a", "value": "1", "status": "ACTIVE"}])
    assert recs[0]["status"] == "active"


def test_filter_keeps_only_active():
    """Bug 3: filter must drop pending, keep only active."""
    recs = [
        {"id": "a", "value": "1", "status": "active"},
        {"id": "b", "value": "2", "status": "pending"},
        {"id": "c", "value": "3", "status": "inactive"},
    ]
    kept = filter(recs)
    assert [r["id"] for r in kept] == ["a"], f"pending leaked through: {kept}"


def test_aggregate_rounds_to_two_decimals():
    """Bug 4a: aggregation must use exact two-decimal arithmetic."""
    out = aggregate([{"id": "a", "value": "1.1", "status": "active"},
                     {"id": "b", "value": "2.2", "status": "active"}])
    assert out["active"] == 3.30, f"not rounded: {out['active']!r}"


def test_aggregate_survives_non_numeric_value():
    """Bug 4b: a non-numeric value must not crash the pipeline."""
    out = aggregate([{"id": "a", "value": "abc", "status": "active"}])
    assert out["active"] == 0.0


def test_full_pipeline_end_to_end():
    data = (
        "acct-7|  10.5  |active\n"
        "x|3.5|PENDING\n"
        "y|1.1|active\n"
        "z|2.2|active\n"
        "bad line here\n"
    )
    out = format(aggregate(filter(normalize(ingest(data)))))
    assert out == "active:13.80", f"pipeline output wrong: {out!r}"
