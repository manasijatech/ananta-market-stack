# Angel One SmartAPI Setup

Market Stack connects Angel One with SmartAPI credentials, your Angel client code, PIN, and TOTP.

## What You Need

| Market Stack field | Paste this |
| --- | --- |
| API key | Angel One SmartAPI app key |
| Client code | Angel One client code or user ID |
| PIN | Angel One login PIN |
| TOTP secret | Optional authenticator or QR secret for automation |

## Before You Start

1. Create or open your [Angel One SmartAPI app](https://smartapi.angelone.in/).
2. Copy the API key from the app.
3. Keep your Angel client code and PIN ready.
4. Make sure TOTP is enabled for your Angel account.

## Add Angel One In Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Angel One**.
4. Paste the API key, client code, and PIN.
5. Add the TOTP secret only if you want automated refresh.
6. Save the broker account.

## Connect The Session

If TOTP secret is not stored:

1. Open the saved Angel One broker account.
2. Enter client code, PIN, and the current 6-digit TOTP.
3. Submit to generate the session.

If TOTP secret is stored, Market Stack can attempt automated session refresh using the saved PIN and TOTP secret.

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
