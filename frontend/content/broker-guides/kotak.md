# Kotak Neo Setup

Market Stack connects Kotak Neo with UCC and portal access token. Sessions use mobile number, TOTP, and MPIN.

## What You Need

| Market Stack field | Paste this |
| --- | --- |
| UCC | Kotak Unique Client Code |
| Portal access token | Kotak Neo portal access token |
| Mobile number | Optional at setup, required for session login |
| MPIN | Optional at setup, required for session login |
| TOTP secret | Optional authenticator or QR secret for automation |

## Before You Start

1. Enable [Kotak Neo Trade API access](https://www.kotakneo.com/platform/kotak-neo-trade-api/) for your account.
2. Copy your UCC.
3. Generate or copy the portal access token.
4. Keep registered mobile number, MPIN, and current TOTP ready.
5. Keep TOTP secret ready only if you want automation.

## Add Kotak Neo In Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Kotak Neo**.
4. Paste UCC and portal access token.
5. Add mobile number, MPIN, and TOTP secret only if you want automated refresh.
6. Save the broker account.

## Connect The Session

Manual session:

1. Open the saved Kotak Neo broker account.
2. Enter registered mobile number, current 6-digit TOTP, and MPIN.
3. Submit to create the trading session.

Automated refresh:

1. Store mobile number, MPIN, and TOTP secret.
2. Market Stack can use those saved values to rebuild the session.

## Advantages

- Works with Kotak's portal token plus trade-session flow.
- Manual mode lets you avoid storing MPIN and TOTP secret.
- Automation is possible when mobile number, MPIN, and TOTP secret are stored.

## Disadvantages

- Portal access token and trade session are separate credentials.
- Manual mode needs mobile number, current TOTP, and MPIN during refresh.
- Automation requires storing MPIN and TOTP secret.

**Recommendation:** Store mobile number, MPIN, and TOTP secret only if you need automated refresh. Otherwise use manual session login.

## Notes

- The current 6-digit TOTP is not the same as the TOTP secret.
- Keep portal access token, MPIN, and TOTP secret private.
- Use the mobile number registered with Kotak Neo.
