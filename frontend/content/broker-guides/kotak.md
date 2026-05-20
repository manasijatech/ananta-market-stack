# Kotak Neo Setup

Market Stack connects Kotak Neo with UCC and portal access token, then uses mobile number, TOTP, and MPIN for sessions.

## What You Need

| Market Stack field  | Backend payload field | Required             | Notes                                         |
| ------------------- | --------------------- | -------------------- | --------------------------------------------- |
| Account label       | `label`               | Yes                  | A friendly name for this Kotak account.       |
| UCC                 | `ucc`                 | Yes                  | Unique Client Code for Kotak.                 |
| Portal access token | `portal_access_token` | Yes                  | Bearer token from Kotak Neo developer portal. |
| Mobile number       | `mobile_number`       | Optional at creation | Required during session login.                |
| MPIN                | `mpin`                | Optional at creation | Used during session login or automation.      |
| TOTP secret         | `totp_secret`         | Optional             | Used for automation.                          |

## Setup Steps

1. Open your Kotak Neo developer or API portal.
2. Copy your UCC or client code.
3. Generate and copy the portal access token.
4. Keep registered mobile number, MPIN, and TOTP ready.
5. Save the broker account in Market Stack.

## Quick Links

- [Kotak Neo Trade API page](https://www.kotakneo.com/platform/kotak-neo-trade-api/)
- [Kotak Neo API setup guide](https://www.kotakneo.com/investing-guide/trading-account/kotak-neo-trade-api-guide)
- [Kotak support: API registration process](https://www.kotakneo.com/support/what-is-the-api-registration-process-in-the-new-version/)
- [Kotak Trade API support center](https://www.kotakneo.com/support/trading/trade-api-and-terminals/)

## Session Flow In Market Stack

1. Open the saved Kotak broker account.
2. Enter registered mobile number, current 6-digit TOTP, and MPIN.
3. Submit the session form to create a trading session.

## Important Notes

- Portal access token and trade session credentials are separate pieces of the Kotak flow.
- Store MPIN carefully. Market Stack sends it to the backend for encrypted storage only when provided.
