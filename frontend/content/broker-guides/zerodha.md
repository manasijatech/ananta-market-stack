# Zerodha Kite Connect Setup

Use this guide to connect Zerodha to Market Stack with Kite Connect.

## 1. Get Your Zerodha Client ID

Your Zerodha Client ID is your normal Kite login ID, usually something like `AB1234`.

Find it in Kite:

1. Open [kite.zerodha.com](https://kite.zerodha.com).
2. Sign in.
3. Click your profile/user ID in the top-right.
4. Copy the short user ID shown there.

If you cannot find it, use Zerodha's recovery page: [recover Kite user ID](https://support.zerodha.com/category/trading-and-markets/general-kite/login-credentials-of-trading-platforms/articles/retrieve-user-id).

Do not use **Zerodha partner ID**. That is a different optional field on the developer profile page.

## 2. Create The Kite Connect App

1. Open the [Kite developer console](https://developers.kite.trade/).
2. Go to **My apps**.
3. Create a new Kite Connect app.
4. Choose **Personal** unless you specifically need the paid Connect plan.
5. Fill the app form with the values below.

![Zerodha Kite Connect create app form](/docs/zerodha-create-app.svg)

| Kite app field    | Enter this                                               |
| ----------------- | -------------------------------------------------------- |
| App name          | `Market Stack` or any name you recognize                 |
| Zerodha Client ID | Your Kite login/client ID, for example `AB1234`          |
| Redirect URL      | `http://localhost:3000/broker-connections`               |
| Postback URL      | Leave empty unless Zerodha forces it for your app type   |
| Description       | Anything short, for example `Personal trading dashboard` |

## 3. Copy API Key And Secret

After the app is created:

1. Open the app in the Kite developer console.
2. Copy the **API key**.
3. Copy the **API secret**.
4. Keep the API secret private.

## 4. Add Zerodha In Market Stack

1. Open Market Stack at `http://localhost:3000`.
2. Go to **Brokers**.
3. Click **Add broker**.
4. Select **Zerodha**.
5. Enter:

| Market Stack field | Paste this                                    |
| ------------------ | --------------------------------------------- |
| Account label      | Any friendly name, for example `Main Zerodha` |
| API key            | Kite Connect API key                          |
| API secret         | Kite Connect API secret                       |

6. Save the broker account.

## 5. Connect The Daily Session

Zerodha access tokens are short-lived. You usually need to authorize once per trading day.

1. Open the saved Zerodha broker account in Market Stack.
2. Click **Open broker login**.
3. Complete Zerodha login and authorization.
4. Zerodha redirects back to Market Stack at a URL like:

```text
http://localhost:3000/broker-connections?status=success&request_token=...&action=login&type=login
```

5. Market Stack reads the `request_token` automatically, exchanges it with FastAPI, verifies the account, and opens the broker detail page.

If the automatic flow does not complete, copy only the `request_token` value from the browser address bar and paste it into the manual field shown under **or enter manually**.

## Important

- Use `http://localhost:3000` from start to finish while developing locally.
- The redirect URL in Zerodha must exactly match `http://localhost:3000/broker-connections`.
- API key and API secret are saved in Market Stack; the Zerodha Client ID is only needed while creating the Kite app.
- Re-authorize when Zerodha expires the session.
