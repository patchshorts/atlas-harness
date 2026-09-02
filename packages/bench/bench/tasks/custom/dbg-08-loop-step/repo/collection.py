"""Collects evens and odds with a step bug (skips odd indices)."""
def collect_even_and_odd(n):
    evens = []
    odds = []
    for i in range(0, n, 2):
        if i % 2 == 0:
            evens.append(i)
        else:
            odds.append(i)
    return evens, odds
