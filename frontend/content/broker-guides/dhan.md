# Dhan API Setup

Ananta Market Stack supports two Dhan setup styles:

- consent login, where you complete Dhan login and Ananta consumes the returned `tokenId` automatically
- TOTP automation, where the backend stores PIN and TOTP secret for the official automation path

## What You Need

| Ananta Market Stack field | Paste this |
| --- | --- |
| API key | Dhan API key |
| API secret | Dhan API secret |
| Client ID | Dhan client ID |
| PIN | Optional Dhan login PIN for automation |
| TOTP secret | Optional authenticator or QR secret for automation |

## Before You Start

1. Enable [Dhan API access](https://dhanhq.co/) for your account.
2. Generate or copy the API key and API secret.
3. Copy your Dhan client ID. This is assigned by Dhan; do not enter Ananta or your app name.
4. If Dhan asks for a redirect URL, use the exact Ananta broker callback URL: `<your Ananta URL>/broker-connections`.
5. Set up static IP allowlisting if Dhan requires it.
6. Decide whether you want consent login or TOTP automation.
7. Keep PIN and TOTP secret ready only if you want automated refresh.

## Option 1: Consent Login

Use this when you want to avoid storing PIN and TOTP secret and are fine completing the Dhan login flow when needed. Ananta should finish setup automatically after Dhan redirects back.

## Option 2: TOTP Automation

Use this when you want the backend to attempt token generation with stored PIN and TOTP secret.

## Add Dhan In Ananta Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Dhan**.
4. Choose **Manual consent** or **TOTP automation**.
5. Paste API key, API secret, and client ID.
6. If you chose automation, also paste PIN and TOTP secret.
7. Save the broker account.

## Connect The Session

Consent login:

1. Open the saved Dhan broker account.
2. Click **Login with Dhan**.
3. Complete Dhan login and 2FA.
4. Dhan redirects back to Ananta.
5. Ananta reads the returned `tokenId` and activates the session automatically.

Manual fallback:

1. Use this only if Ananta did not finish setup automatically.
2. If the returned URL visibly contains `tokenId`, paste that value into **Manual fallback**.
3. Submit to update the session.

Automated refresh:

1. Store PIN and TOTP secret while adding the broker.
2. Ananta Market Stack can use those saved values to attempt official token generation.

## Advantages

- API key, API secret, and client ID are straightforward to save.
- Consent login avoids storing PIN and TOTP secret.
- Optional PIN and TOTP secret can reduce daily manual work.

## Disadvantages

- Consent login requires a fresh Dhan login when the session expires.
- Automation requires storing PIN and TOTP secret.
- Static IP allowlisting may be required before live API calls work.

**Recommendation:** Use consent login if you do not want to store PIN and TOTP secret. Use PIN plus TOTP secret if you need unattended refresh.

## Notes

- Ananta Market Stack labels Dhan `app_id` as **API key** and `app_secret` as **API secret**.
- The Dhan callback URL must include `/broker-connections`; the domain alone is not enough.
- Paste `tokenId` manually only when automatic callback completion fails.
- Keep API secret, PIN, and TOTP secret private.
