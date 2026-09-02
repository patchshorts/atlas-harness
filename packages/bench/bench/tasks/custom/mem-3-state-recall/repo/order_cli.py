"""Order CLI with a state machine.

Commands: start, add <item>, add --discount <pct> <item>, checkout, quit.
BUG: a discount registered with `add --discount` is lost by the time checkout runs.
"""
import sys

STATE = {"open": False, "items": [], "discount": None}

def cmd_start():
    STATE.update(open=True, items=[], discount=None)
    return "order opened"

def cmd_add(args):
    if not STATE["open"]:
        return "no open order (use start)"
    discount = None
    if len(args) >= 3 and args[0] == "--discount":
        discount = int(args[1])
        args = args[2:]
    item = " ".join(args)
    if not item:
        return "usage: add [--discount <pct>] <item>"
    STATE["items"].append(item)
    # BUG: the discount is parsed but never stored in STATE, so checkout
    # never sees it. Discounts are silently lost.
    return f"added {item}"

def cmd_checkout():
    if not STATE["open"]:
        return "no open order"
    total = 100 * len(STATE["items"])
    disc = STATE["discount"]
    if disc is not None:
        total = int(total * (100 - disc) / 100)
    STATE["open"] = False
    return f"total={total}"

def main(argv):
    for line in argv:
        parts = line.split()
        if not parts:
            continue
        cmd, args = parts[0], parts[1:]
        if cmd == "start":
            print(cmd_start())
        elif cmd == "add":
            print(cmd_add(args))
        elif cmd == "checkout":
            print(cmd_checkout())
        elif cmd == "quit":
            return

if __name__ == "__main__":
    main(sys.argv[1:])
