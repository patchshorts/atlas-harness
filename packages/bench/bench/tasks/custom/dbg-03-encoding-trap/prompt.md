Fix repo/reader.py so all tests pass. read_lines(path) must return the lines
of a text file. The fixtures directory contains BOTH utf-8 and utf-16 (with
BOM) files. Do not modify tests/ or fixtures/.