"""Upstox market feed WebSocket (protobuf). Implement in a worker using official SDK."""


class UpstoxStreamPlaceholder:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def connect(self) -> None:
        raise NotImplementedError("Use Upstox streaming worker + MarketDataFeed proto.")
