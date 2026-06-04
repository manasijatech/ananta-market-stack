# INDmoney Token Setup

Ananta Market Stack connects INDmoney with a manual access token. There is no automated login or TOTP flow for INDmoney in Ananta Market Stack right now.

## What You Need

| Ananta Market Stack field | Paste this                           |
| ------------------ | ------------------------------------ |
| Access token       | Current INDmoney bearer access token |

## Before You Start

1. Open the [INDstocks API trading page](https://www.indstocks.com/features/api-trading).
2. Sign in with your INDmoney or INDstocks account.
3. Generate or copy a fresh access token.
4. Set up static IP allowlisting if INDmoney requires it for your account.

## Add INDmoney In Ananta Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **INDmoney**.
4. Paste the access token.
5. Save the broker account.

## Refresh The Token

INDmoney access tokens can expire. When that happens:

1. Generate or copy a fresh token from INDmoney.
2. Open the saved INDmoney broker account in Ananta Market Stack.
3. Paste the new token in the session form.
4. Submit to update the stored token.

## Advantages

- Simple setup with only one required credential.
- No API secret, password, or TOTP secret is stored.
- Useful when you want quick broker access with a manually generated token.

## Disadvantages

- Manual refresh is required when the token expires.
- Not ideal for unattended alerts or scheduled jobs.
- Static IP allowlisting may still be required by INDmoney.

**Recommendation:** Use INDmoney only if manual token refresh works for your workflow. For unattended automation, prefer a broker connection that supports automated refresh.

## Notes

- Treat access tokens like passwords.
- Keep the token private.
- Paste only the token value, not the word `Bearer`.
