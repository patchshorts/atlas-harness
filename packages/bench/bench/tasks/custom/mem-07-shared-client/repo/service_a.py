from client import ApiClient

def fetch_user(client, user_id):
    # Bug: uses fetch() which is NOT part of the contract
    return client.fetch(f"/users/{user_id}")
