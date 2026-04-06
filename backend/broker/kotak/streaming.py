"""Kotak HSWebSocket — extension point (see HSWebSocketLib in reference)."""


class KotakStreamPlaceholder:
    def __init__(self, session_bundle: str) -> None:
        self.session_bundle = session_bundle

    def connect(self) -> None:
        raise NotImplementedError("Kotak websocket in worker.")
