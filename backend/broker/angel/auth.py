from __future__ import annotations

import json

from broker.core.http import get_httpx_client


def login(
    *, api_key: str, client_code: str, pin: str, totp: str
) -> tuple[str | None, str | None, str | None]:
    payload = json.dumps({"clientcode": client_code, "password": pin, "totp": totp})
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-UserType": "USER",
        "X-SourceID": "WEB",
        "X-ClientLocalIP": "127.0.0.1",
        "X-ClientPublicIP": "127.0.0.1",
        "X-MACAddress": "00:00:00:00:00:00",
        "X-PrivateKey": api_key,
    }
    r = get_httpx_client().post(
        "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
        headers=headers,
        content=payload,
    )
    try:
        data = r.json()
    except Exception:
        return None, None, r.text[:500]
    if "data" in data and "jwtToken" in data["data"]:
        return data["data"]["jwtToken"], data["data"].get("feedToken"), None
    return None, None, data.get("message", "login failed")
