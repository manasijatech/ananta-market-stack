"""
Live market streaming (WebSocket).

Zerodha uses Kite Connect ticker. Run streaming in a dedicated worker with reconnect
logic; this module documents the extension point only.
"""


class ZerodhaTickerPlaceholder:
    """Wire ``api_key``, ``access_token``, and subscribe to instrument tokens."""

    def __init__(self, api_key: str, access_token: str) -> None:
        self.api_key = api_key
        self.access_token = access_token

    def connect(self) -> None:
        raise NotImplementedError(
            "Implement Kite ticker client here or use an external streaming worker."
        )
