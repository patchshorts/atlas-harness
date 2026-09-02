"""Lower-bound trap: comparison uses > not >=."""
def lower_bound(arr, x):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] > x:
            hi = mid - 1
        else:
            lo = mid + 1
    return lo