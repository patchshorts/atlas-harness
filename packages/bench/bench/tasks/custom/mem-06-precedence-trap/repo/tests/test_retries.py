import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import svc_x, svc_y, svc_z

def test_default():
    assert svc_x.get_max_retries({}) == 5   # file beats default
    assert svc_y.get_max_retries({}) == 7
    assert svc_z.get_max_retries({}) == 3   # no file -> default

def test_env_beats_file():
    assert svc_x.get_max_retries({"X_MAX_RETRIES": "9"}) == 9
    assert svc_y.get_max_retries({"Y_MAX_RETRIES": "2"}) == 2

def test_invalid_env_falls_back():
    assert svc_x.get_max_retries({"X_MAX_RETRIES": "abc"}) == 5
    assert svc_z.get_max_retries({"Z_MAX_RETRIES": "abc"}) == 3
