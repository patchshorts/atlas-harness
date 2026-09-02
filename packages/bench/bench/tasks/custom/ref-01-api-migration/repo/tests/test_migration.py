import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client import connect
from main import run
from subpkg.worker import work

CFG = {"host": "h", "port": 1234, "user": "u"}

def test_new_api_direct():
    assert connect(cfg=CFG) == CFG

def test_main_site_migrated():
    assert run("h", 1234, "u") == CFG

def test_subpkg_site_migrated():
    assert work(CFG) == CFG
