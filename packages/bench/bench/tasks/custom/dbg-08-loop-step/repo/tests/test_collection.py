import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from collection import collect_even_and_odd

def test_n4():
    evens, odds = collect_even_and_odd(4)
    assert evens == [0, 2] and odds == [1, 3]

def test_n1():
    evens, odds = collect_even_and_odd(1)
    assert evens == [0] and odds == []

def test_n7():
    evens, odds = collect_even_and_odd(7)
    assert evens == [0, 2, 4, 6] and odds == [1, 3, 5]
