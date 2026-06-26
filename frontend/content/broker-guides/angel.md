# Angel One SmartAPI Setup

Ananta Market Stack supports two Angel One setup styles:

- manual TOTP sessions, where you enter the live 6-digit TOTP during refresh
- stored-TOTP automation, where the backend stores PIN and TOTP secret for refresh attempts

## What You Need

| Ananta Market Stack field | Paste this |
| --- | --- |
| API key | Angel One SmartAPI app key |
| Client code | Angel One client code or user ID |
| PIN | Only for automation mode |
| TOTP secret | Only for automation mode |

## Before You Start

1. Create or open your [Angel One SmartAPI app](https://smartapi.angelone.in/).
2. Copy the API key from the app.
3. Make sure TOTP is enabled for your Angel account.
4. Decide whether you want manual TOTP entry or stored-TOTP automation.
5. Keep PIN and authenticator secret ready only if you want automation.

## Option 1: Manual TOTP

Use this when you want to keep the setup lighter and enter the current TOTP during session refresh.

## Option 2: Stored TOTP Automation

Use this when you want the backend to store PIN and TOTP secret and attempt SmartAPI refresh for you.

## Add Angel One In Ananta Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Angel One**.
4. Choose **Manual TOTP** or **Stored TOTP automation**.
5. Paste the API key and client code.
6. If you chose automation, also paste PIN and TOTP secret.
7. Save the broker account.

## Connect The Session

If TOTP secret is not stored:

1. Open the saved Angel One broker account.
2. Enter client code, PIN, and the current 6-digit TOTP.
3. Submit to generate the session.

If TOTP secret is stored, Ananta Market Stack can attempt automated session refresh using the saved PIN and TOTP secret.

## Advantages

- Good broker option when you already use Angel SmartAPI.
- TOTP secret enables automation.
- PIN and secrets are stored encrypted by the backend.

## Disadvantages

- Manual refresh needs the current 6-digit TOTP.
- Automation depends on Angel's SmartAPI login rules staying compatible.
- Requires storing PIN, and optionally TOTP secret, for automated refresh.

**Recommendation:** Store the TOTP secret only if you need automation. Otherwise keep the setup manual and enter the current 6-digit TOTP when refreshing the session.

## Notes

- The current 6-digit TOTP is not the same as the TOTP secret.
- Do not paste the 6-digit TOTP into the TOTP secret field.
- Keep the PIN and TOTP secret private.
