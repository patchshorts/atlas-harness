"""Merge sort with a subtle slicing bug (drops the middle element)."""
def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    # TODO(perf): consider allocating the merge buffer once
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid + 1:])
    return merge(left, right)

def merge(left, right):
    out = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    out.extend(left[i:])
    out.extend(right[j:])
    return out
