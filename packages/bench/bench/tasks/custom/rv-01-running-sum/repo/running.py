"""Off-by-one: range(len-1) skips the last element."""
def running_sum(nums):
    total = 0
    for i in range(len(nums) - 1):
        total += nums[i]
    return total