from __future__ import annotations

import hashlib

import httpx
import pytest

from broker.arrow import auth
from broker.arrow.http_api import ArrowAPIError, ArrowHTTP


def test_arrow_checksums_and_login_url() -> None:
    assert auth.access_checksum("app", "secret", "request") == hashlib.sha256(
        b"app:secret:request"
    ).hexdigest()
    callback = hashlib.sha256(b"request:app").hexdigest()
    assert auth.callback_checksum_valid("app", "request", callback)
    assert not auth.callback_checksum_valid("app", "request", "bad")
    assert auth.login_url("app id") == "https://app.arrow.trade/app/login?appID=app+id"


def test_exchange_request_token_sends_both_checksum_spellings() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.content)
        seen.update(body)
        return httpx.Response(
            200,
            request=request,
            json={"status": "success", "data": {"token": "access", "userID": "AR123"}},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result, error = auth.exchange_request_token(
            app_id="app", app_secret="secret", request_token="request", client=client
        )

    assert error is None
    assert result and result["access_token"] == "access"
    assert seen["checkSum"] == seen["checksum"]
    assert seen["token"] == "request"


def test_arrow_access_token_expiry_is_24_hours() -> None:
    from datetime import datetime

    from common.datetime_compat import UTC

    generated = datetime(2026, 7, 21, 3, 0, tzinfo=UTC)
    assert (auth.token_expiry(generated) - generated).total_seconds() == 86_400


def test_arrow_limiter_is_shared_for_the_same_account_credentials() -> None:
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={}))) as first_client:
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={}))) as second_client:
            first = ArrowHTTP("app", "token", client=first_client)
            second = ArrowHTTP("app", "token", client=second_client)
            assert first.limiter is second.limiter


def test_arrow_read_backoff_and_mutation_no_retry() -> None:
    read_calls = 0

    def read_handler(request: httpx.Request) -> httpx.Response:
        nonlocal read_calls
        read_calls += 1
        if read_calls == 1:
            return httpx.Response(429, request=request, headers={"Retry-After": "0"}, json={"message": "slow down"})
        return httpx.Response(200, request=request, json={"status": "success", "data": {"ok": True}})

    with httpx.Client(transport=httpx.MockTransport(read_handler)) as read_client:
        api = ArrowHTTP("read-app", "read-token", client=read_client)
        assert api.request("GET", "/user/details", group="funds")["data"]["ok"] is True
    assert read_calls == 2

    mutation_calls = 0

    def mutation_handler(request: httpx.Request) -> httpx.Response:
        nonlocal mutation_calls
        mutation_calls += 1
        return httpx.Response(
            500,
            request=request,
            json={"message": "rejected", "errorCode": "ORDER_REJECTED"},
        )

    with httpx.Client(transport=httpx.MockTransport(mutation_handler)) as mutation_client:
        mutation_api = ArrowHTTP("mutation-app", "mutation-token", client=mutation_client)
        with pytest.raises(ArrowAPIError) as caught:
            mutation_api.request("POST", "/order/regular", group="orders", json={}, retry_read=False)
    assert caught.value.error_code == "ORDER_REJECTED"
    assert mutation_calls == 1
