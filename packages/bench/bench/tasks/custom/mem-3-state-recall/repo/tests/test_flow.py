import subprocess, sys, os

def run(*lines):
    out = subprocess.run([sys.executable, "order_cli.py", *lines],
                         capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return out.stdout.strip().splitlines()

def test_no_discount():
    lines = run("start", "add apple", "add banana", "checkout")
    assert lines[-1] == "total=200", lines

def test_discount_applies():
    lines = run("start", "add --discount 25 apple", "add banana", "checkout")
    assert lines[-1] == "total=150", lines

def test_discount_isolated_per_order():
    run("start", "add --discount 25 apple", "checkout")
    lines = run("start", "add apple", "checkout")
    assert lines[-1] == "total=100", lines
