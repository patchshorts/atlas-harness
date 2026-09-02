import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from running import running_sum
def test_full():
    assert running_sum([1,2,3,4])==10
def test_single():
    assert running_sum([7])==7
def test_empty():
    assert running_sum([])==0
def test_neg():
    assert running_sum([-2,-5])==-7
