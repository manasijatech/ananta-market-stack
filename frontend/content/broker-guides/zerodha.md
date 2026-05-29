# Zerodha Kite Connect Setup

Market Stack connects Zerodha with a Kite Connect API key and API secret. Zerodha sessions usually need daily authorization.

## What You Need

| Market Stack field | Paste this |
| --- | --- |
| API key | Kite Connect API key |
| API secret | Kite Connect API secret |

## Before You Start

1. Create or open your [Kite Connect app](https://developers.kite.trade/).
2. Set the redirect URL to `http://localhost:3000/broker-connections` for local Market Stack.
3. Copy the API key and API secret.
4. Keep your normal Zerodha login ready for session authorization.

## Add Zerodha In Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Zerodha**.
4. Paste API key and API secret.
5. Save the broker account.

## Connect The Session

1. Open the saved Zerodha broker account.
2. Open the Zerodha login URL from the session panel.
3. Complete Zerodha login and authorization.
4. Zerodha redirects back to `/broker-connections` with a `request_token`.
5. Market Stack reads the token and connects the account automatically.

If automatic connection fails, copy only the `request_token` value from the browser address bar and paste it into the manual `request_token` field.

## Advantages

- Simple setup with only API key and API secret.
- No Zerodha password or TOTP secret is stored in Market Stack.
- Market Stack can handle the redirect token automatically.

## Disadvantages

- Zerodha sessions usually need fresh authorization each trading day.
- Redirect URL must match the Kite Connect app.
- Manual fallback requires copying the `request_token` correctly.

**Recommendation:** Use this flow when you are comfortable authorizing Zerodha daily. Keep the redirect URL fixed until the login flow works reliably.

## Notes

- Use `http://localhost:3000/broker-connections` for local setup.
- For hosted installs, use your public app domain: `https://your-app-domain.example/broker-connections`.
- The Zerodha app redirect URL must match Market Stack's callback route.
- Keep the API secret private.
