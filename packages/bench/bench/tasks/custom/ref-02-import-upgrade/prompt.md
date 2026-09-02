Upgrade repo/ from the deprecated pkg.old_util to pkg2.new_util so all
tests pass. NOTE: the new parse() returns an OrderedDict-preserving dict and
rejects duplicate keys, while the old one silently kept the last value. The
legacy behavior must remain available through a small shim in legacy.py.
Do not modify tests/.