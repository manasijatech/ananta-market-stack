# Kotak Neo Setup

Ananta Market Stack supports two Kotak Neo setup styles:

- manual session entry, where you enter mobile number, live TOTP, and MPIN during refresh
- stored TOTP plus MPIN automation, where the backend stores those values for session rebuilds

## What You Need

| Ananta Market Stack field | Paste this |
| --- | --- |
| UCC | Kotak Unique Client Code |
| Portal access token | Kotak Neo portal access token |
| Mobile number | Only for automation mode |
| MPIN | Only for automation mode |
| TOTP secret | Only for automation mode |

## Before You Start

1. Enable [Kotak Neo Trade API access](https://www.kotakneo.com/platform/kotak-neo-trade-api/) for your account.
2. Copy your UCC.
3. Generate or copy the portal access token.
4. Decide whether you want manual session entry or stored automation.
5. Keep registered mobile number, MPIN, and current TOTP ready.
6. Keep TOTP secret ready only if you want automation.

## Option 1: Manual Session

Use this when you want to keep mobile number, MPIN, and TOTP secret out of stored broker credentials.

## Option 2: Stored TOTP + MPIN

Use this when you want the backend to rebuild sessions using stored mobile number, MPIN, and TOTP secret.

## Add Kotak Neo In Ananta Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Kotak Neo**.
4. Choose **Manual session** or **Stored TOTP + MPIN**.
5. Paste UCC and portal access token.
6. If you chose automation, also paste mobile number, MPIN, and TOTP secret.
7. Save the broker account.

## Connect The Session

Manual session:

1. Open the saved Kotak Neo broker account.
2. Enter registered mobile number, current 6-digit TOTP, and MPIN.
3. Submit to create the trading session.

Automated refresh:

1. Store mobile number, MPIN, and TOTP secret.
2. Ananta Market Stack can use those saved values to rebuild the session.

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
