# Upstox OAuth Setup

Market Stack connects Upstox through OAuth using API key, API secret, and an exact redirect URI match.

## What You Need

| Market Stack field | Backend payload field | Required | Notes |
| --- | --- | --- | --- |
| Account label | `label` | Yes | A friendly name for this Upstox account. |
| API key | `api_key` | Yes | Upstox client ID or API key. |
| API secret | `api_secret` | Yes | Upstox API secret. |
| Redirect URI | `redirect_uri` | Yes | Must match the Upstox developer portal exactly. |

## Setup Steps

1. Create an Upstox developer app from [Upstox developer apps](https://account.upstox.com/developer/apps).
2. Copy the API key and API secret.
3. Add the redirect URI in Upstox. For local development, use `http://localhost:3001/brokers`. This is your frontend `NEXT_PUBLIC_APP_URL` plus `/brokers`. In production, use the same route on your deployed frontend domain, for example `https://your-domain.com/brokers`.
4. Enter the exact same redirect URI in Market Stack. The FastAPI backend stores this value and sends it again while exchanging the `authorization_code`, so even a small mismatch will fail.
5. Save the broker account.

## Session Flow In Market Stack

1. Open the saved Upstox broker account.
2. Open the Upstox login URL from the session panel.
3. Complete OAuth authorization. Upstox documents this as the [login and authorization-code flow](https://upstox.com/developer/api-documentation/login).
4. Upstox redirects to your configured frontend URL, such as `http://localhost:3001/brokers?code=...`.
5. Market Stack automatically reads the `code`, exchanges it with FastAPI, verifies the account, and redirects you to the broker detail page.
6. If auto-connect cannot find the right account, copy the returned code from the address bar and paste it into the `authorization_code` session form manually.

## Important Notes

- Use `http://localhost:3001/brokers` for local development because this frontend has a real `/brokers` page and no dedicated `/callback/upstox` page yet.
- Use `http://localhost:3001` throughout local setup so the browser keeps the same auth session before and after broker login.
- Redirect URI mismatches are the most common Upstox setup issue. The URI in the Upstox developer app, the Market Stack account form, and the generated login URL must be identical.
- Keep the API secret private.
- For a deeper reference after setup, use Upstox's official [authentication docs](https://upstox.com/developer/api-documentation/authentication).
