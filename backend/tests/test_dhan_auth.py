from __future__ import annotations

from broker.dhan import auth
from common.datetime_compat import UTC


class _Response:
    status_code = 200
    text = ""

    def json(self) -> dict[str, str]:
        return {
            "accessToken": "dhan-access-token",
            "expiryTime": "2026-07-17T12:30:00+05:30",
        }


class _Client:
    def __init__(self) -> None:
        self.request: tuple[str, dict[str, str], dict[str, str]] | None = None

    def post(self, url: str, *, headers: dict[str, str], params: dict[str, str]) -> _Response:
        self.request = (url, headers, params)
        return _Response()


def test_consume_consent_uses_redirect_token_id_and_preserves_expiry(monkeypatch) -> None:
    client = _Client()
    monkeypatch.setattr(auth, "get_httpx_client", lambda: client)

    payload, error = auth.consume_consent(
        app_id="api-key",
        app_secret="api-secret",
        token_id="redirect-token-id",
    )

    assert error is None
    assert payload == {
        "access_token": "dhan-access-token",
        "expiry_time": "2026-07-17T12:30:00+05:30",
    }
    assert client.request == (
        "https://auth.dhan.co/app/consumeApp-consent",
        {
            "app_id": "api-key",
            "app_secret": "api-secret",
            "Content-Type": "application/json",
        },
        {"tokenId": "redirect-token-id"},
    )


def test_parse_expiry_treats_naive_dhan_time_as_ist() -> None:
    parsed = auth.parse_expiry("2026-07-18 09:37:00")

    assert parsed is not None
    assert parsed.tzinfo is UTC
    assert parsed.isoformat() == "2026-07-18T04:07:00+00:00"
