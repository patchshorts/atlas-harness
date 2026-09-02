"""Order total = item total + shipping fee."""
from fees import shipping


def order_total(items_total, weight_kg):
    return items_total + shipping(weight_kg)