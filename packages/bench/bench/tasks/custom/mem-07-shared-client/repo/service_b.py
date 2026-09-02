from client import ApiClient

def create_user(client, body):
    return client.post("/users", body)
