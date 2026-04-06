from __future__ import annotations

import json

from broker.core.http import get_httpx_client


def totp_mpin_session(
    *,
    ucc: str,
    portal_access_token: str,
    mobile_number: str,
    totp: str,
    mpin: str,
) -> tuple[str | None, str | None]:
    mobile_number = mobile_number.strip().replace("+91", "").replace(" ", "")
    if mobile_number.startswith("91") and len(mobile_number) == 12:
        mobile_number = mobile_number[2:]
    mobile_e164 = f"+91{mobile_number}"
    c = get_httpx_client()
    headers = {
        "Authorization": portal_access_token,
        "neo-fin-key": "neotradeapi",
        "Content-Type": "application/json",
    }
    r1 = c.post(
        "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin",
        headers=headers,
        content=json.dumps(
            {"mobileNumber": mobile_e164, "ucc": ucc, "totp": totp}
        ),
    )
    d1 = r1.json()
    if "data" not in d1 or d1.get("data", {}).get("status") != "success":
        return None, d1.get("errMsg", d1.get("message", "totp failed"))
    view_token, view_sid = d1["data"]["token"], d1["data"]["sid"]
    h2 = {
        **headers,
        "Sid": view_sid,
        "Auth": view_token,
    }
    r2 = c.post(
        "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate",
        headers=h2,
        content=json.dumps({"mpin": mpin}),
    )
    d2 = r2.json()
    if "data" not in d2 or d2.get("data", {}).get("status") != "success":
        return None, d2.get("errMsg", d2.get("message", "mpin failed"))
    trading_token = d2["data"]["token"]
    trading_sid = d2["data"]["sid"]
    base_url = d2["data"].get("baseUrl", "")
    if not base_url:
        return None, "missing baseUrl"
    bundle = f"{trading_token}:::{trading_sid}:::{base_url}:::{portal_access_token}"
    return bundle, None
