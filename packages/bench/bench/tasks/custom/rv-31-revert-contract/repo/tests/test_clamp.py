import pytest
from module import clamp


def test_lower_guard():
    assert clamp(0, 1, 3) == 1


def test_in_range():
    assert clamp(2, 1, 3) == 2


def test_upper_guard():
    assert clamp(5, 1, 3) == 3


def test_contradictory_bounds():
    with pytest.raises(ValueError):
        clamp(2, 5, 1)