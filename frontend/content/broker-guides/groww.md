# Groww Trade API Setup

Market Stack supports three Groww connection modes. Pick one mode and enter only the fields for that mode.

## Before You Start

1. Open the [Groww Trade API portal](https://groww.in/trade-api).
2. Sign in with your Groww account.
3. Add or update the static IP that will call Groww APIs.

Static IP setup is required for Groww API access.

## Option 1: API Approval

Use this when you have a Groww API key and API secret.

| Market Stack field | Paste this |
| --- | --- |
| API key | Groww API key |
| API secret | Groww API secret |

Advantages:

- Good default option for normal setup.
- Uses Groww's official API approval flow.
- Can refresh the session from Market Stack after approval.

Disadvantages:

- Requires both API key and API secret.
- You may need to approve the session in Groww when refreshing.
- Static IP must be correct before API calls work.

## Option 2: TOTP

Use this when you want Market Stack to generate Groww sessions with your TOTP setup.

| Market Stack field | Paste this |
| --- | --- |
| TOTP API key | Groww user API key for TOTP auth |
| TOTP secret | Authenticator or QR secret |

Advantages:

- Best option for automation.
- No need to paste a new access token manually.
- Market Stack can generate the current OTP from the saved TOTP secret.

Disadvantages:

- Requires storing the TOTP secret.
- Setup is stricter because the TOTP API key and secret must match Groww's TOTP flow.
- Static IP is still required.

## Option 3: Access Token

Use this when you already have a fresh Groww access token and want the fastest manual setup.

| Market Stack field | Paste this |
| --- | --- |
| Access token | Current Groww access token |

Advantages:

- Fastest one-time setup.
- No API secret or TOTP secret is stored.
- Useful for testing whether Groww data access is working.

Disadvantages:

- Manual mode only.
- You must paste a new token when it expires.
- Not ideal for unattended alerts or scheduled jobs.

**Recommendation:** Use **TOTP** for regular automated use. Use **API approval** if you do not want to store the TOTP secret. Use **Access token** only for quick testing or manual sessions.

## Add Groww In Market Stack

1. Go to **Brokers**.
2. Click **Add broker**.
3. Select **Groww**.
4. Choose **API approval**, **TOTP**, or **Access token**.
5. Fill only the fields for that option.
6. Save the broker account.

## Notes

- Do not mix fields from different options.
- Keep API secrets, TOTP secrets, and access tokens private.
- Market Stack does not need a redirect URL for Groww.
