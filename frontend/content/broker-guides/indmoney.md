# INDmoney Token Setup

Ananta Market Stack supports either a manual INDstocks access token or daily TOTP-based token generation.

## What You Need

| Ananta Market Stack field | Paste this                           |
| ------------------ | ------------------------------------ |
| Manual token | Current INDstocks access token |
| TOTP automation | Client ID, MPIN, and the base32 TOTP secret |

## Before You Start

1. Open the [INDstocks API trading page](https://www.indstocks.com/features/api-trading).
2. Sign in with your INDmoney or INDstocks account.
3. For automation, choose **Setup TOTP**, finish the authenticator enrollment, and save the secret in a password manager. Copy the displayed Client ID.
4. Set up static IP allowlisting for order placement.

## Add INDmoney In Ananta Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **INDmoney**.
4. Choose **Daily TOTP** and enter Client ID, MPIN, and TOTP secret, or choose **Manual token** and paste an access token.
5. Save the broker account.

## Refresh The Token

INDmoney TOTP tokens last 24 hours. Ananta refreshes configured TOTP accounts in the daily maintenance pass; use the broker session panel for an immediate refresh if needed. Manual tokens can be replaced there too.

INDstocks keeps only one TOTP-generated token live. Do not generate tokens from a second machine/process for the same account: it invalidates Ananta's token.

## Advantages

- Daily unattended token refresh for accounts configured with TOTP.
- Manual-token setup remains available.

## Disadvantages

- TOTP setup is completed in the INDstocks web dashboard; the secret is shown once.
- Wrong TOTP codes can lock token generation, so ensure the server clock is synchronized.
- Static IP allowlisting may still be required by INDmoney.

**Recommendation:** Use TOTP automation for unattended workflows and keep only one Ananta deployment generating the token.

## Notes

- Treat access tokens like passwords.
- Keep the token private.
- Paste only the token value, not the word `Bearer`.
