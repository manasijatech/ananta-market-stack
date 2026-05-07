# Groww Trade API Setup

Use this guide when connecting Groww to Market Stack with **API approval** mode.

## 1. Open Groww API Keys

1. Open the [Groww Trade API portal](https://groww.in/trade-api).
2. Sign in with your Groww account.
3. Go to **API keys**.

You should see the API key dashboard with **Update static IP** and **Generate API key** actions.

## 2. Add Static IP First

Groww requires a static IP for API access.

1. Click **Update static IP**.
2. Add the static IP that will call Groww APIs.
3. Save the IP.
4. Return to the API key dashboard.

Do this before generating or using the API key, otherwise live API calls can fail even if the credentials are correct.

## 3. Generate API Key

1. Click **Generate API key**.
2. Enter a clear name, for example `Market Stack`.
3. Continue and confirm the generation flow.
4. Copy the generated **API key**.
5. Copy the generated **API secret**.

Keep the API secret private. Groww may not show it again after you leave the page.

## 4. Add Groww In Market Stack

1. Open Market Stack at `http://localhost:3000`.
2. Go to **Brokers**.
3. Click **Add broker**.
4. Select **Groww**.
5. Choose **API approval** mode.
6. Enter:

| Market Stack field | Paste this |
| --- | --- |
| Account label | Any friendly name, for example `Main Groww` |
| API key | Groww API key |
| API secret | Groww API secret |

7. Save the broker account.

## 5. Connect Session

After saving the account:

1. Open the Groww broker detail page.
2. Use the session action shown there to refresh or create the Groww session.
3. If Groww asks for approval, complete it in the Groww app or portal.

## Important

- Static IP is mandatory for Groww API access.
- Use **API approval** in Market Stack when you have API key and API secret.
- Do not paste API key and API secret into the TOTP or access-token modes.
- Keep the API secret private.
- Market Stack does not need a redirect URL for Groww.
