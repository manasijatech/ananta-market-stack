# Upstox OAuth Setup

Market Stack connects Upstox with API key, API secret, and an exact redirect URI.

## What You Need

| Market Stack field | Paste this |
| --- | --- |
| API key | Upstox API key or client ID |
| API secret | Upstox API secret |
| Redirect URI | Exact redirect URI saved in the Upstox app |

## Before You Start

1. Create or open your [Upstox developer app](https://account.upstox.com/developer/apps).
2. Copy the API key and API secret.
3. Set the redirect URI in Upstox.
4. For local Market Stack, use `http://localhost:3000/broker-connections`.
5. If you use Upstox token-request approval, set the notifier webhook to `http://localhost:3000/api/broker-callbacks/upstox/notifier` for local Market Stack.
6. Use the same redirect URI in Market Stack.

## Add Upstox In Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Upstox**.
4. Paste API key, API secret, and redirect URI.
5. Save the broker account.

## Connect The Session

1. Open the saved Upstox broker account.
2. Open the Upstox login URL from the session panel.
3. Complete Upstox login and authorization.
4. Upstox redirects back to `/broker-connections` with an authorization code.
5. Market Stack reads the code and connects the account automatically.

If automatic connection fails, copy only the `code` value from the browser address bar and paste it into the manual `authorization_code` field.

## Advantages

- Uses the standard OAuth authorization flow.
- Market Stack can read the returned authorization code automatically.
- No broker password or TOTP secret is stored in Market Stack.

## Disadvantages

- Redirect URI must match exactly.
- Session refresh requires user authorization when the token expires.
- A small typo in domain, path, or protocol can break the flow.

**Recommendation:** Use `http://localhost:3000/broker-connections` for local setup and keep the same URL everywhere until the flow works.

## Notes

- The redirect URI in Upstox and Market Stack must be identical.
- For hosted installs, use your public app domain: `https://your-app-domain.example/broker-connections`.
- If you use the Upstox notifier flow, use the same app domain with `/api/broker-callbacks/upstox/notifier`.
- Use `http://localhost:3000` before and after broker login during local development.
- Keep the API secret private.
