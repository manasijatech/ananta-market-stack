# INDmoney Token Setup

Market Stack connects INDmoney by storing a current bearer access token.

## What You Need

| Market Stack field | Backend payload field | Required | Notes |
| --- | --- | --- | --- |
| Account label | `label` | Yes | A friendly name for this INDmoney account. |
| Access token | `access_token` | Yes | Bearer token used for account and session access. |

## Setup Steps

1. Generate or capture a current INDmoney bearer access token from your broker web session or portal flow.
2. Confirm your account has static IP setup if INDmoney requires it.
3. Paste the access token into Market Stack.
4. Save the broker account.

## Quick Links

- [INDstocks API trading page](https://www.indstocks.com/features/api-trading)
- [INDmoney website](https://www.indmoney.com/)
- [INDstocks API token flow](https://www.indstocks.com/app/api-trading)

## Session Flow In Market Stack

1. Open the saved INDmoney broker account.
2. If the token expires, paste a fresh token into the INDmoney session form.
3. Submit the session form to update stored access.

## Important Notes

- Treat access tokens like passwords.
- INDmoney tokens may be short-lived, so refresh may be needed often.
- Static IP whitelisting may be required by the broker.
