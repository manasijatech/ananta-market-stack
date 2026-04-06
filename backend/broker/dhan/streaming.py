"""Dhan market feed WebSocket — rate-limited REST quote used in API; WS in worker."""


class DhanStreamPlaceholder:
    def __init__(self, access_token: str, client_id: str) -> None:
        self.access_token = access_token
        self.client_id = client_id

    def connect(self) -> None:
        raise NotImplementedError("Dhan websocket feed in dedicated service.")
