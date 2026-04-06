"""Angel SmartAPI WebSocket streaming — implement with official smartWebSocketV2 in a worker."""


class AngelStreamPlaceholder:
    def __init__(self, jwt_token: str, feed_token: str | None, api_key: str) -> None:
        self.jwt_token = jwt_token
        self.feed_token = feed_token
        self.api_key = api_key

    def connect(self) -> None:
        raise NotImplementedError("Wire smartWebSocketV2 in a dedicated process.")
