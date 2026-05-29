# Broker Auth Flows

This document explains how each broker account should be created, how daily session tokens are obtained or refreshed, and which flows in this repo are official broker-supported flows versus optional or experimental shortcuts.

The broker data APIs under `/api/v1/broker-accounts/{account_id}/data/...` are read-only. They depend on these session flows being active because instrument sync, quotes, OHLC, historical data, option-chain, and websocket inspection all call the broker using the stored account session.

## Terms

- `app credentials`: broker-issued API/app keys that identify the application.
- `session token`: the broker-issued short-lived token used on trading/data APIs.
- `official flow`: documented by the broker's own API docs.
- `experimental flow`: useful in practice, but based on web-login behavior rather than the broker's supported API contract.

## Zerodha

### Default official flow

1. Create the account with `api_key` and `api_secret`.
2. Call `GET /api/v1/broker-accounts/{account_id}/sessions/zerodha`.
3. Redirect the user to `login_url`.
4. Zerodha redirects the browser back to the frontend callback route, normally `/broker-connections`, with `request_token`.
5. Call `POST /api/v1/broker-accounts/{account_id}/sessions/zerodha` with that `request_token`.
6. Use the broker operations APIs until the token expires the next morning.

### Example create request

```json
{
  "broker": "zerodha",
  "label": "primary-kite",
  "api_key": "kite_app_key",
  "api_secret": "kite_app_secret"
}
```

### Example session exchange request

```json
{
  "request_token": "abc123returnedbyredirect"
}
```

### Optional experimental flow

If the user explicitly consents, the backend can store:

- `login_user_id`
- `login_password`
- `totp_secret`

Then `POST /api/v1/broker-accounts/{account_id}/sessions/zerodha/refresh` can attempt to:

1. log into the Zerodha web session,
2. submit the generated TOTP,
3. extract a `request_token`,
4. exchange it into the official daily `access_token`.

This is intentionally labeled experimental because it depends on Zerodha web endpoints rather than Kite Connect's documented login/redirect contract.

## Upstox

### Default official OAuth flow

1. Configure the Upstox app redirect URI as the frontend callback route, normally `https://your-app.example.com/broker-connections`.
2. Create the account with `api_key`, `api_secret`, and the same `redirect_uri`.
3. Call `GET /api/v1/broker-accounts/{account_id}/sessions/upstox`.
4. Redirect the user to `login_url`.
5. Upstox redirects the browser back to the frontend callback route with `authorization_code` or `code`.
6. Call `POST /api/v1/broker-accounts/{account_id}/sessions/upstox`.

### Example create request

```json
{
  "broker": "upstox",
  "label": "main-upstox",
  "api_key": "upstox_app_key",
  "api_secret": "upstox_app_secret",
  "redirect_uri": "https://your-app.example.com/broker-connections"
}
```

### Example session exchange request

```json
{
  "authorization_code": "code_from_upstox_redirect"
}
```

### Official semi-automated flow

Upstox also supports a broker-approved token-request flow:

1. Call `POST /api/v1/broker-accounts/{account_id}/sessions/upstox/request-token`.
2. Upstox prompts the user for approval inside Upstox channels.
3. Upstox delivers the token to your frontend notifier webhook at `POST /api/broker-callbacks/upstox/notifier`.
4. The frontend forwards the payload to `POST /api/v1/broker-accounts/sessions/upstox/notifier`.

This is still official, and is preferable to any credential-scraping approach.

## Dhan

### Official flows

- Manual portal token generation.
- Official consent flow:
  1. `POST /api/v1/broker-accounts/{account_id}/sessions/dhan/start`
  2. user logs in through the broker login page
  3. app receives `tokenId`
  4. `POST /api/v1/broker-accounts/{account_id}/sessions/dhan`
- Official TOTP automation flow:
  - store `client_id`, `pin`, and `totp_secret`
  - use `POST /api/v1/broker-accounts/{account_id}/sessions/dhan/refresh`

## Angel

### Current repo flow

- Manual session refresh:
  - `POST /api/v1/broker-accounts/{account_id}/sessions/angel`
  - requires `client_code`, `pin`, and `totp`
- Optional automation:
  - store `pin` and `totp_secret`
  - use `POST /api/v1/broker-accounts/{account_id}/sessions/angel/refresh`

Note: Angel auth requirements have evolved over time; keep SmartAPI policy changes under review before treating this flow as fully stable.

## Groww

### Official flows

- API approval flow:
  - store `api_key` and `api_secret`
  - use `POST /api/v1/broker-accounts/{account_id}/sessions/groww`
- TOTP flow:
  - store `totp_token` and `totp_secret`
  - `totp_token` here is the Groww user API key used in the TOTP token-generation call
  - use `POST /api/v1/broker-accounts/{account_id}/sessions/groww`
  - for automation, the backend generates the OTP from the stored secret

### Example TOTP create request

```json
{
  "broker": "groww",
  "label": "groww-totp",
  "totp_token": "groww_totp_token",
  "totp_secret": "base32_totp_secret"
}
```

## Kotak

### Current repo flow

- Manual:
  - create with `ucc` and `portal_access_token`
  - call `POST /api/v1/broker-accounts/{account_id}/sessions/kotak` with `mobile_number`, `totp`, and `mpin`
- Optional automation:
  - store `mobile_number`, `mpin`, and `totp_secret`
  - call `POST /api/v1/broker-accounts/{account_id}/sessions/kotak/refresh`

## INDmoney

### Current repo flow

- Manual only in this repo.
- Create account without token if needed.
- When the user generates a new portal token, call:
  - `POST /api/v1/broker-accounts/{account_id}/sessions/indmoney`

The repo also emits notifications when the token is missing or expired.

## Session Status And Notifications

For every broker, first check the corresponding `GET /sessions/{broker}` endpoint. It tells you:

- whether a valid token/session is present,
- whether automation is supported,
- whether automation is currently enabled,
- what field or login step is still required,
- what the next best action is.

The daily maintenance loop runs after `06:30 IST` and writes reminders or refresh-failure alerts to:

- `GET /api/v1/notifications`

The daily instrument-sync loop runs after `08:30 IST` and refreshes the SQLite `broker_instruments` cache for each broker. Sync failures also show up through the notification system and `broker_instrument_sync_runs`.

You can also trigger it on demand with:

- `POST /api/v1/broker-accounts/maintenance/run`
- `POST /api/v1/broker-accounts/{account_id}/data/instruments/sync`

## Order Mutations

Order placement, modification, cancellation, smart-order, and close-all routes remain implemented for later phases, but they are intentionally disabled by default in this early-stage project.

- They are hidden from Swagger / OpenAPI.
- Direct calls return `403` unless `ENABLE_ORDER_MUTATIONS=true`.

## Source Notes

- Zerodha official docs: `kite.trade/docs/connect/v3/user/`
- Upstox official docs: `upstox.com/developer/api-documentation/`
- Dhan official docs: `dhanhq.co/docs/v2/authentication/`
- Groww official docs: `groww.in/trade-api/docs/python-sdk`
- Kotak SDK reference: `github.com/Kotak-Neo/Kotak-neo-api-v2`

The Zerodha web-login automation path is based on observed web behavior and similar community examples, not on the official Kite Connect login contract.
