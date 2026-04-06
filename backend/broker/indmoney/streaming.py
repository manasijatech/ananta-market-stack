"""Indmoney streaming — extension point."""


class IndmoneyStreamPlaceholder:
    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def connect(self) -> None:
        raise NotImplementedError("Indmoney websocket in worker.")
