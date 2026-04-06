"""Groww streaming — extension point for websocket/SDK."""


class GrowwStreamPlaceholder:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def connect(self) -> None:
        raise NotImplementedError("Groww live stream in external worker.")
