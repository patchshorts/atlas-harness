"""Reads text files assuming utf-8 only."""
def read_lines(path):
    with open(path, 'r', encoding='utf-8') as f:
        return [line.rstrip('\n') for line in f]
