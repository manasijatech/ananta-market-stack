# Dhan API Setup

Ananta Market Stack connects Dhan with API key, API secret, and your Dhan client ID. PIN and TOTP secret are optional and are used for automation.

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
3. Copy your Dhan client ID.
4. Set up static IP allowlisting if Dhan requires it.
5. Keep PIN and TOTP secret ready only if you want automated refresh.

## Add Dhan In Ananta Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Dhan**.
4. Paste API key, API secret, and client ID.
5. Add PIN and TOTP secret only if you want automation.
6. Save the broker account.

## Connect The Session

Manual session:

1. Open the saved Dhan broker account.
2. Click **Start Dhan consent flow**.
3. Complete Dhan login and 2FA.
4. Paste the returned `token_id` into Ananta Market Stack.
5. Submit to update the session.

Automated refresh:

1. Store PIN and TOTP secret while adding the broker.
2. Ananta Market Stack can use those saved values to attempt official token generation.

## Advantages

- API key, API secret, and client ID are straightforward to save.
- Manual consent flow avoids storing PIN and TOTP secret.
- Optional PIN and TOTP secret can reduce daily manual work.

## Disadvantages

- Manual mode requires a fresh `token_id` when the session expires.
- Automation requires storing PIN and TOTP secret.
- Static IP allowlisting may be required before live API calls work.

**Recommendation:** Use manual consent if you do not want to store PIN and TOTP secret. Use PIN plus TOTP secret if you need unattended refresh.

## Notes

- Ananta Market Stack labels Dhan `app_id` as **API key** and `app_secret` as **API secret**.
- Paste only the `token_id` value during manual session refresh.
- Keep API secret, PIN, and TOTP secret private.
