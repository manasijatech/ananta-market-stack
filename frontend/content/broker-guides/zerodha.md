# Zerodha Kite Connect Setup

Ananta Market Stack supports two Zerodha setup styles:

- the normal Kite Connect redirect flow with API key and API secret
- an optional experimental web-login automation flow using Zerodha user ID, password, and TOTP secret

## What You Need

| Ananta Market Stack field | Paste this |
| --- | --- |
| API key | Kite Connect API key |
| API secret | Kite Connect API secret |
| Login user ID | Optional Zerodha user ID for automation |
| Login password | Optional Zerodha password for automation |
| TOTP secret | Optional Base32 authenticator secret for automation |

## Before You Start

1. Create or open your [Kite Connect app](https://developers.kite.trade/).
2. Set the redirect URL to `http://localhost:3000/broker-connections` for local Ananta Market Stack.
3. Copy the API key and API secret.
4. Decide whether you want API-only setup or optional automation.
5. If you want automation, keep your Zerodha user ID, password, and authenticator secret ready.

## Option 1: API Only

Use this when you want the normal Zerodha login and redirect flow.

Advantages:

- Simple and closest to Zerodha's official flow.
- No Zerodha password or TOTP secret is stored in Ananta Market Stack.
- Good default for manual daily authorization.

Disadvantages:

- Zerodha sessions usually need fresh authorization each trading day.
- You must open the login flow manually when the session expires.

## Option 2: Web Login Automation

Use this when you want the backend to optionally automate the Zerodha web-login step and generate the daily session using stored credentials.

Advantages:

- Can reduce daily manual refresh work.
- Reuses the same kind of user ID, password, and TOTP-secret setup you use in `kite_router.py`.

Disadvantages:

- Stores Zerodha login password and TOTP secret in encrypted backend storage.
- This path is experimental because it depends on Zerodha web-login behavior, not only the official Kite redirect contract.
- If Zerodha changes the web flow, automation can break and fall back to manual authorization.

## Add Zerodha In Ananta Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Zerodha**.
4. Choose **API only** or **Web login automation**.
5. Paste API key and API secret.
6. If you chose automation, also paste login user ID, login password, and TOTP secret.
7. Save the broker account.

## Connect The Session

1. Open the saved Zerodha broker account.
2. Open the Zerodha login URL from the session panel.
3. Complete Zerodha login and authorization.
4. Zerodha redirects back to `/broker-connections` with a `request_token`.
5. Ananta Market Stack reads the token and connects the account automatically.

If automatic connection fails, copy only the `request_token` value from the browser address bar and paste it into the manual `request_token` field.

If you saved automation credentials too, the backend can also attempt automated refresh from the broker detail page or maintenance flow.

**Recommendation:** Use **API only** if you want the cleanest supported setup. Use **Web login automation** only when you explicitly want convenience over strict reliance on the official login contract.

## Notes

- Use `http://localhost:3000/broker-connections` for local setup.
- For hosted installs, use your public app domain: `https://your-app-domain.example/broker-connections`.
- The Zerodha app redirect URL must match Ananta Market Stack's callback route.
- Keep the API secret private.
- The TOTP secret is not the same as the current 6-digit OTP.
