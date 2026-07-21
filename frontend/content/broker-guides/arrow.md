# Arrow Trade API setup

Create an Arrow Developer application from **Profile → Trading APIs**. Register the exact callback URL displayed by Ananta and the backend's static outbound IP. Copy the generated `appID` and `appSecret` into Ananta; secrets are encrypted before storage.

## Session flow

Use **Login with Arrow**. Arrow redirects to Ananta with `request-token` and `checksum`; Ananta validates the callback and exchanges the request token for an access token. Access tokens last 24 hours. Optional user ID, password, and TOTP-secret storage enables the SDK-compatible automated login path.

## Limits and trading behavior

- Orders, positions, holdings, funds, historical data, and market-data REST APIs are limited to 10 requests per second per product.
- Arrow disables unprotected market orders. Ananta enables Market Price Protection for uniform `MARKET` requests, which can leave a protected limit order open.
- Standard streaming is the default. HFT is opt-in, zstd-compressed, and limited to 512 symbols per request and 1,024 symbols per connection.
- Refresh the Arrow instrument master after 08:00 IST each trading day.

Official reference: [Arrow Trade documentation](https://docs.arrow.trade/).
