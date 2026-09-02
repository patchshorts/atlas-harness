from client import ApiClient

def list_users(client):
    return client.get("/users")
