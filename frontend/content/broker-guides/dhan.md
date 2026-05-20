# Dhan API Setup

Market Stack connects Dhan with API key, API secret, and your Dhan client ID.

## What You Need

| Market Stack field | Backend payload field | Required | Notes                                                             |
| ------------------ | --------------------- | -------- | ----------------------------------------------------------------- |
| Account label      | `label`               | Yes      | A friendly name for this Dhan account.                            |
| API key            | `app_id`              | Yes      | Stored as `app_id` because that is the current backend field.     |
| API secret         | `app_secret`          | Yes      | Stored as `app_secret` because that is the current backend field. |
| Client ID          | `client_id`           | Yes      | Your Dhan client ID.                                              |
| PIN                | `pin`                 | Optional | Used for automation when supported.                               |
| TOTP secret        | `totp_secret`         | Optional | Used for automated token generation when supported.               |

## Setup Steps

1. Create API credentials in your Dhan API or developer console.
2. Copy the API key and API secret.
3. Copy your Dhan client ID.
4. Configure TOTP and static IP whitelisting if Dhan requires it for your account.
5. Save the broker account in Market Stack.

## Quick Links

- [Dhan web login](https://web.dhan.co/)
- [DhanHQ API access help](https://dhan.co/support/platforms/dhanhq-api/how-to-access-dhan-api/)
- [DhanHQ API access status help](https://dhan.co/support/platforms/dhanhq-api/how-can-i-check-my-api-access-status-for-dhanhq/)
- [DhanHQ token validity help](https://dhan.co/support/platforms/dhanhq-api/what-is-the-maximum-validity-of-an-api-access-token-in-dhan-apis/)
- [DhanHQ API product site](https://dhanhq.co/)

## Session Flow In Market Stack

1. Open the saved Dhan broker account.
2. Start the Dhan consent flow from the session panel.
3. Complete Dhan login and 2FA.
4. Paste the returned `token_id` into the Dhan session form.

## Important Notes

- Static IP whitelisting may be required before live API calls work.
- Market Stack labels the fields as API key and API secret, while the backend currently stores them as `app_id` and `app_secret`.
