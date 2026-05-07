# Angel One SmartAPI Setup

Market Stack connects Angel One through SmartAPI credentials and a TOTP-backed session login.

## What You Need

| Market Stack field | Backend payload field | Required | Notes |
| --- | --- | --- | --- |
| Account label | `label` | Yes | A friendly name for this Angel One account. |
| API key | `api_key` | Yes | SmartAPI application key. |
| Client code | `client_code` | Yes | Angel One user or client ID. |
| PIN | `pin` | Yes | Angel One login PIN. |
| TOTP secret | `totp_secret` | Optional | Store only if you want automation later. |

## Setup Steps

1. Create or open your Angel One SmartAPI app.
2. Copy the API key.
3. Keep your client code and PIN ready.
4. Configure an authenticator app for TOTP if your account does not already have one.
5. Save the broker account in Market Stack.

## Quick Links

- [Angel One SmartAPI portal](https://smartapi.angelone.in/)
- [SmartAPI docs](https://smartapi.angelone.in/docs)
- [SmartAPI TOTP setup guide](https://smartapi.angelone.in/smartapi/forum/post/11137)
- [SmartAPI Python SDK](https://github.com/angel-one/smartapi-python)
- [SmartAPI Java SDK](https://github.com/angel-one/smartapi-java)

## Session Flow In Market Stack

1. Open the saved Angel One broker account.
2. Enter client code, PIN, and the current 6-digit TOTP.
3. Submit the session form to generate broker session tokens.

## Important Notes

- The 6-digit TOTP entered during login is not the same as the TOTP secret.
- TOTP secret is optional and intended for automation.
