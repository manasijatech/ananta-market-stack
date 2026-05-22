# API Overview

The backend exposes a FastAPI service. All versioned routes use the `/api/v1` prefix.

Local API docs are available after starting the backend:

- Swagger UI: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/health`
- Versioned health: `http://127.0.0.1:8000/api/v1/health`

Hosted developer documentation is available at [developers.manasija.in/docs](https://developers.manasija.in/docs).

## Core Routes

- `GET /health`
- `GET /health/redis`
- `GET /brokers/supported`
- `GET /users/me`
- `POST /users`
- `GET /users/{user_id}`

## Broker Accounts

- `GET /broker-accounts`
- `POST /broker-accounts`
- `GET /broker-accounts/{account_id}`
- `DELETE /broker-accounts/{account_id}`
- `POST /broker-accounts/{account_id}/verify`
- `POST /broker-accounts/{account_id}/quotes`
- `POST /broker-accounts/maintenance/run`

Session routes are exposed under:

```text
/broker-accounts/{account_id}/sessions/{broker}
```

See [backend/docs/broker_auth_flows.md](../backend/docs/broker_auth_flows.md) for broker-specific session behavior.

## Broker Operations

Unified broker operation routes include:

- `GET /broker-accounts/{account_id}/profile`
- `GET /broker-accounts/{account_id}/portfolio/orders`
- `GET /broker-accounts/{account_id}/portfolio/trades`
- `GET /broker-accounts/{account_id}/portfolio/positions`
- `GET /broker-accounts/{account_id}/portfolio/holdings`
- `GET /broker-accounts/{account_id}/portfolio/funds`
- `POST /broker-accounts/{account_id}/margin/calculate`
- `GET /broker-accounts/{account_id}/data/capabilities`
- `POST /broker-accounts/{account_id}/data/instruments/sync`
- `POST /broker-accounts/{account_id}/data/instruments/sync-csv`
- `DELETE /broker-accounts/{account_id}/data/instruments`
- `GET /broker-accounts/{account_id}/data/instruments/search`
- `POST /broker-accounts/{account_id}/data/quotes`
- `POST /broker-accounts/{account_id}/data/ohlc`
- `POST /broker-accounts/{account_id}/data/historical`
- `POST /broker-accounts/{account_id}/data/option-chain`
- `POST /broker-accounts/{account_id}/data/greeks`
- `GET /broker-accounts/{account_id}/data/stream/status`

Broker API responses are generally broker-native shapes. The API layer does not fully normalize every portfolio, order, or market-data payload.

## Notifications And Alerts

Notifications:

- `GET /notifications`
- `POST /notifications/{notification_id}/read`

User alert routes:

- `GET /alert-templates`
- `POST /alert-templates/{template_id}/instantiate`
- `GET /alert-workflows`
- `POST /alert-workflows`
- `GET /alert-workflows/{workflow_id}`
- `PUT /alert-workflows/{workflow_id}`
- `POST /alert-workflows/{workflow_id}/enable`
- `POST /alert-workflows/{workflow_id}/disable`
- `POST /alert-workflows/{workflow_id}/duplicate`
- `POST /alert-workflows/{workflow_id}/test`
- `GET /alert-workflows/{workflow_id}/runs`
- `GET /alert-workflows/history/all`
- `GET /alert-notifications`
- `GET /alert-notifications/unread-count`
- `POST /alert-notifications/{notification_id}/read`
- `POST /alert-notifications/read-all`
- `GET /alert-notifications/stream`
- `POST /alert-notifications/test`
- `GET /alert-channels`
- `PUT /alert-channels/{channel_type}`
- `POST /alert-channels/{channel_type}/test`
- `GET /live-streams/status`
- `GET /live-streams/subscriptions`
- `POST /live-streams/subscriptions`
- `PUT /live-streams/subscriptions/replace`
- `DELETE /live-streams/subscriptions/{subscription_id}`

## Broker Chat And Agent Tools

Broker chat provides a durable asynchronous chat surface for broker-data tools. See:

- [Broker chat backend](../backend/docs/broker_chat.md)
- [Broker agent tools](../backend/docs/broker_agent_tools.md)
- [LLM provider config](../backend/docs/llm_provider_config.md)
