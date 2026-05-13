# Alpha API Frontend Reference

Source studied: `/Users/dev/Desktop/alpha-api`

Date studied: 2026-05-13

This document maps every mounted Alpha API endpoint to its frontend use case and lists the request/response schemas declared in the Alpha API codebase. It is intended as the frontend integration reference for Market Stack.

## Base URLs And Auth

- Local app mount in Alpha API: `/v1`
- Public developer host used by frontend server actions: `https://developers.manasija.in`
- Docs route: `/docs`
- Customer auth: `X-API-Key: <key>` header, or `?api_key=<key>` query parameter.
- Internal/admin auth: `INTERNAL_API_KEY` via the same `X-API-Key` header or `api_key` query parameter.
- Most customer market-data routes are billable and gated by product entitlement.
- Common list pagination shape: `data: T[]`, `has_next: boolean`.
- Common multi-value query style: comma-separated or repeated params, e.g. `?symbols=RELIANCE,TCS` or `?symbols=RELIANCE&symbols=TCS`.
- `symbols`, `ids`, and `categories` are capped at 20 unique values per request in the query helpers.

## Product Catalog Notes

REST products and notable route IDs:

| Product | Route IDs | Default rate limits | Credit notes |
|---|---|---:|---|
| News | `news_feed` | 120 rpm / 50000 daily | 1 credit |
| Announcements | `announcements_summary`, `announcement_categories`, `announcement_detail`, `announcement_symbol_metadata`, `announcement_attachment` | 60 rpm / 10000 daily | categories cost 0, attachments cost 2 |
| Earnings | `earnings_summary`, `earnings_detail`, `earnings_attachment` | 60 rpm / 10000 daily | attachments cost 2 |
| Alerts | `alerts` | 60 rpm / 15000 daily | 1 credit |
| Conference Calls | `concalls`, `concall_detail`, `concall_transcript` | 40 rpm / 5000 daily | transcript costs 2 |
| Daily Summary | `daily_summary_generate` | 10 rpm / 1000 daily | 10 credits |
| Batch Summary | `batch_submit`, `batch_list`, `batch_status`, `batch_cancel`, `batch_results` | 10 rpm / 500 daily | route calls cost 0, each processed item costs 10 |

WebSocket products: `news`, `announcements`, `earnings`, `concalls`, `alerts`. Each requires an addon, costs 1 credit to connect and 1 credit to subscribe, has concurrency limit 5, and supports tiers `basic_500`, `pro_1000`, and `full_market`.

## Frontend Integration Map

High-value Market Stack surfaces for Alpha API data:

| Frontend area | Recommended Alpha endpoints | Use |
|---|---|---|
| System config | backend config API | `MANASIJA_API_KEY` is saved through System Config and read server-side by frontend actions. |
| Watchlists | `/v1/symbols/metadata`, `/v1/news`, `/v1/alerts`, WebSocket streams | Enrich tickers with company/logo/sector, show latest news/alerts per symbol, stream watchlist updates. |
| Alert workflow editor | `/v1/symbols/metadata`, `/v1/alerts`, WebSocket `/v1/ws` | Better symbol identification, sector context, live alert previews, realtime subscription setup. |
| Alert subscriptions/stream manager | `/v1/ws`, `/v1/account/limits`, `/v1/account/usage` | Show stream tier/caps, connection status, subscribed products, usage/credits. |
| Dashboard overview | `/v1/news`, `/v1/announcements`, `/v1/earnings`, `/v1/alerts`, `/v1/account/usage` | Market activity feed, portfolio/watchlist highlights, account balance widgets. |
| Company/security detail page | `/v1/symbols/metadata`, `/v1/news`, `/v1/announcements`, `/v1/earnings`, `/v1/concalls` | One-symbol research page with filings, earnings, news, concalls, and artifacts. |
| Filing/document viewer | `/v1/announcements/items`, `/v1/announcements/attachments`, `/v1/earnings/{id}`, `/v1/earnings/attachments` | Detail drawers, source PDF buttons, attachment download/open flows. |
| Portfolio intelligence | `/v1/batch/jobs` | Bulk portfolio-summary jobs. |
| Internal admin console | `/v1/admin/accounts/*`, `/v1/api-keys/*`, `/v1/internal/ops/runtime-audit` | Account provisioning, key management, credit ledger, runtime support. |

## Mounted Endpoints

### Docs

| Method | Endpoint | Auth | Response | Frontend use case |
|---|---|---|---|---|
| GET | `/docs` | none | Scalar API docs HTML | Developer-facing API docs link. |

### News

| Method | Endpoint | Auth | Query/body | Response schema | Frontend use case |
|---|---|---|---|---|---|
| GET | `/v1/news` | customer | `symbols`, `sentiment=positive|negative|neutral`, `from`, `to`, `page`, `limit<=100` | `PaginatedResponse[NewsItem]` | News feed, watchlist/company news panels, dashboard market tape. |

### Symbols

| Method | Endpoint | Auth | Query/body | Response schema | Frontend use case |
|---|---|---|---|---|---|
| GET | `/v1/symbols/metadata` | customer | required `symbols`, max 20 | `SymbolMetadataResponse` | Resolve ticker to company name, logo, sector, industry, market cap, theme, BSE scrip code. Best fit for watchlist rows, alert symbol pickers, company headers, dashboard context. |

### Announcements

| Method | Endpoint | Auth | Query/body | Response schema | Frontend use case |
|---|---|---|---|---|---|
| GET | `/v1/announcements/categories` | customer | none | `StringListResponse` | Build category filter dropdowns. |
| GET | `/v1/announcements` | customer | `symbols`, `categories`, `from`, `to`, `detailed`, `page`, `limit<=500` | `PaginatedResponse[AnnouncementDetail]` | Exchange announcement feed, watchlist announcement tab, compliance/fundamental event timeline. |
| GET | `/v1/announcements/items` | customer | required `ids`, `detailed=true` default | `AnnouncementBatchResponse` | Batch hydrate selected announcement IDs for detail drawers or saved notifications. |
| GET | `/v1/announcements/attachments` | customer | required `ids` | `BatchAttachmentLookupResponse` | Get public/presigned PDF URLs when user clicks source attachment. |

### Earnings

| Method | Endpoint | Auth | Query/body | Response schema | Frontend use case |
|---|---|---|---|---|---|
| GET | `/v1/earnings` | customer | `symbols`, `categories`, `from`, `to`, `detailed`, `page`, `limit<=500` | `PaginatedResponse[AnnouncementDetail]` | Earnings/results feed, watchlist earnings tab, company results history. |
| GET | `/v1/earnings/attachments` | customer | required `ids` | `BatchAttachmentLookupResponse` | Resolve result filing/PDF URLs. |
| GET | `/v1/earnings/{earnings_id}` | customer | path `earnings_id` ObjectId | `AnnouncementDetail` | Earnings detail page or modal. |

### Conference Calls

| Method | Endpoint | Auth | Query/body | Response schema | Frontend use case |
|---|---|---|---|---|---|
| GET | `/v1/concalls` | customer | `symbols`, `from`, `to`, `page`, `limit<=200` | `PaginatedResponse[Concall]` | Concall list, company research tab, watchlist call updates. |
| GET | `/v1/concalls/transcripts` | customer | required `ids` | `BatchAttachmentLookupResponse` | Batch hydrate transcript/audio URLs for lists. |
| GET | `/v1/concalls/{concall_id}` | customer | path `concall_id` ObjectId | `Concall` | Concall detail view. |
| GET | `/v1/concalls/{concall_id}/transcript` | customer | path `concall_id` ObjectId | `PresignedUrlResponse` | Open transcript PDF or audio recording. |

### Alerts

| Method | Endpoint | Auth | Query/body | Response schema | Frontend use case |
|---|---|---|---|---|---|
| GET | `/v1/alerts` | customer | `symbols`, `type`, `from`, `to`, `page`, `limit<=200` | `PaginatedResponse[Alert]` | Alert feed, watchlist alerts, dashboard notification stream. |

### Batch Summary

| Method | Endpoint | Auth | Query/body | Response schema | Frontend use case |
|---|---|---|---|---|---|
| POST | `/v1/batch/jobs` | customer | multipart `file` JSONL, optional `display_name`, optional JSON string `metadata` | `BatchJobResponse` | Upload many portfolio summary requests. |
| GET | `/v1/batch/jobs` | customer | `limit<=100` | `BatchJobListResponse` | Show recent batch summary jobs. |
| GET | `/v1/batch/jobs/{job_id}` | customer | path `job_id` | `BatchJobResponse` | Poll job progress/status. |
| DELETE | `/v1/batch/jobs/{job_id}` | customer | path `job_id` | `BatchJobCancelResponse` | Cancel pending/in-progress batch job. |
| GET | `/v1/batch/jobs/{job_id}/results` | customer | path `job_id` | `application/jsonl` stream | Download completed batch results. |

JSONL input line shape for batch jobs:

```json
{"custom_id":"req-1","portfolio":[{"symbol":"RELIANCE","exposure":15.5},{"symbol":"TCS","exposure":10.2}]}
```

JSONL result line shape:

```json
{"id":"req-1","custom_id":"req-1","response":{"status_code":200,"body":{"summary":"..."}},"error":null}
```

### Customer Account

| Method | Endpoint | Auth | Query/body | Response schema | Frontend use case |
|---|---|---|---|---|---|
| GET | `/v1/account` | customer | none | `AccountDetailResponse` | Account status, balance, enabled products, websocket addons. |
| GET | `/v1/account/limits` | customer | none | `dict` | Show effective per-route limits after product/account/key overrides. |
| GET | `/v1/account/usage` | customer | none | `AccountUsageEnvelope` | Live credits, debited today, route counters, rate limits. |
| GET | `/v1/account/ledger` | customer | `limit<=200` | `LedgerListResponse` | Balance history and audit trail. |

### WebSocket

| Method | Endpoint | Auth | Message | Response | Frontend use case |
|---|---|---|---|---|---|
| WS | `/v1/ws` | customer key in query or header | JSON subscribe message | JSON confirmation/events | Realtime streams for news, announcements, earnings, concalls, alerts. |

Subscribe message:

```json
{"op":"subscribe","product":"announcements","symbols":["RELIANCE","TCS"]}
```

Subscribe response:

```json
{"status":"subscribed","product":"announcements","tier":"basic_500","full_feed":false,"symbols":["RELIANCE","TCS"]}
```

### Global API Key Management

These routes require the internal API key.

| Method | Endpoint | Query/body | Response schema | Frontend/admin use case |
|---|---|---|---|---|
| POST | `/v1/api-keys` | `ApiKeyCreateRequest` | `ApiKeyCreateResponse` | Create a customer key globally. |
| GET | `/v1/api-keys` | `page`, `per_page<=500`, `status`, `user_id`, `include_deleted`, `sort` | `ApiKeyListResponse` | Global key inventory. |
| GET | `/v1/api-keys/{api_key}` | path API key | `ApiKeyGetResponse` | Inspect one key and cache state. |
| PATCH | `/v1/api-keys/{api_key}` | `ApiKeyPatchRequest` | `ApiKeyGetResponse` | Update scopes, status, limits. |
| DELETE | `/v1/api-keys/{api_key}` | path API key, `soft` | `ApiKeyDeleteResponse` | Disable or delete a key. |
| GET | `/v1/api-keys/{api_key}/usage` | path API key, optional `endpoint` | `UsageResponse` | Inspect Redis usage buckets. |
| POST | `/v1/api-keys/migrate` | none | `MigrateResponse` | One-time Redis to MongoDB migration. |
| DELETE | `/v1/api-keys/cache` | none | `CacheClearResponse` | Clear Redis API-key cache. Note: because `DELETE /{api_key}` is registered before `/cache`, verify this route in runtime docs before relying on it. |

### Admin Accounts

These routes require the internal API key.

| Method | Endpoint | Query/body | Response schema | Frontend/admin use case |
|---|---|---|---|---|
| POST | `/v1/admin/accounts` | `AccountCreateRequest` | `AccountDetailResponse` | Provision commercial account. |
| GET | `/v1/admin/accounts` | optional `status` | `AccountListResponse` | Account list page. |
| GET | `/v1/admin/accounts/{account_id}` | path `account_id` | `AccountDetailResponse` | Account detail page. |
| PATCH | `/v1/admin/accounts/{account_id}` | `AccountUpdateRequest` | `AccountDetailResponse` | Update status, products, websocket addons, metadata. |
| POST | `/v1/admin/accounts/{account_id}/credits` | `CreditAdjustmentRequest` | object response | Apply credit topup/manual adjustment. |
| GET | `/v1/admin/accounts/{account_id}/ledger` | `limit`, optional `api_key`, `date_from`, `date_to` | `LedgerListResponse` | Support/audit ledger view. |
| POST | `/v1/admin/accounts/{account_id}/api-keys` | `ApiKeyAdminCreateRequest` | object response | Create API key scoped under account. |
| GET | `/v1/admin/accounts/{account_id}/api-keys` | path `account_id` | `ApiKeyAdminListResponse` | Account key inventory. |
| GET | `/v1/admin/accounts/{account_id}/api-keys/{api_key}` | date range | `AdminApiKeyDetailResponse` | Key detail with live/historical usage. |
| PATCH | `/v1/admin/accounts/{account_id}/api-keys/{api_key}` | `ApiKeyAdminPatchRequest` | object response | Update account-scoped key. |
| DELETE | `/v1/admin/accounts/{account_id}/api-keys/{api_key}` | optional `soft` | object response | Delete or disable account-scoped key. |
| GET | `/v1/admin/accounts/{account_id}/dashboard` | optional `date_from`, `date_to` | `AdminAccountDashboardResponse` | One-call admin account overview. |
| GET | `/v1/admin/accounts/{account_id}/usage` | optional `date_from`, `date_to`, `api_key`, `route_id` | `UsageHistoryEnvelope` | Historical account usage chart/table. |
| GET | `/v1/admin/accounts/{account_id}/api-keys/{api_key}/usage` | optional `date_from`, `date_to`, `route_id` | `UsageHistoryEnvelope` | Historical key usage drilldown. |

### Internal Ops And Webhooks

These routes require the internal API key.

| Method | Endpoint | Query/body | Response | Frontend/internal use case |
|---|---|---|---|---|
| GET | `/v1/internal/ops/runtime-audit` | `sample_limit<=20` | runtime state object | Debug Redis cache, stream lag, worker state. |
| POST | `/v1/internal/webhooks/announcement` | arbitrary JSON payload | `{"status":"ok"}` | Publish announcement payload to `ws:announcements`. |
| POST | `/v1/internal/webhooks/earnings` | arbitrary JSON payload | `{"status":"ok"}` | Publish earnings payload to `ws:earnings`. |
| POST | `/v1/internal/webhooks/concalls` | arbitrary JSON payload | `{"status":"ok"}` | Publish concall payload to `ws:concalls`. |
| POST | `/v1/internal/webhooks/alerts` | arbitrary JSON payload | `{"status":"ok"}` | Publish alert payload to `ws:alerts`. |
| POST | `/v1/internal/webhooks/news` | arbitrary JSON payload | `{"status":"ok"}` | Publish news payload to `ws:news`. |

## Unmounted Endpoint Code

`app/api/v1/endpoints/reports.py` defines `GET /{report_type}` with `MarketReport`, but `app/api/v1/api.py` explicitly does not mount the reports router. Do not call a `/v1/reports/*` endpoint unless the router is mounted later.

If mounted, intended shape would be:

| Method | Endpoint | Query/body | Response schema | Use |
|---|---|---|---|---|
| GET | `/v1/reports/{report_type}` | `report_type=morning|evening`, required `date=YYYY-MM-DD` | `MarketReport` | Timed morning/evening report view. |

## Schemas

### Common Schemas

| Schema | Fields |
|---|---|
| `Attachment` | `has_attachment: bool`, `url: str`, `mime?: string` |
| `Source` | `name: str`, `url: str` |
| `PaginatedResponse[T]` | `data: T[]`, `has_next: bool=false` |
| `ListResponse[T]` | `data: T[]` |

### Market Data Schemas

| Schema | Fields |
|---|---|
| `NewsItem` | `id: str`, `title?: str`, `specific_title?: str`, `summary?: str`, `long_summary?: str`, `company?: str`, `symbol?: str`, `sentiment?: str`, `source?: str`, `article_type?: str`, `link?: str`, `scrip_code?: str`, `date?: str` |
| `Alert` | `id: str`, `symbol: str`, `type?: str`, `reason?: str`, `timestamp?: str`, `meta: object={}` |
| `Concall` | `id: str`, `symbol: str`, `summary?: str`, `completion_response?: str`, `analysis?: any`, `expanded_analysis?: any`, `short_analysis?: any`, `quarter?: str`, `month?: str`, `filename?: str`, `type?: str`, `uploaded_file_type?: str`, `date?: str`, `concall_type?: str`, `transcript_pdf_links?: str[]`, `recording_links?: str[]`, `pdf_r2_key?: str`, `audio_r2_key?: str`, `automated_processing_capable?: bool`, `is_concall?: bool` |
| `MarketReport` | `type: str`, `summary: object`, `date: str`, `source_type?: str` |

### Announcement And Earnings Schemas

| Schema | Fields |
|---|---|
| `AnnouncementMetadata` | `hash?: str`, `is_earnings?: bool`, `category?: str`, `related_categories: str[]`, `descriptor?: str`, `confidence?: float`, `important?: bool`, `research_marked_important?: bool`, `duplicate?: bool` |
| `AnnouncementSummary` | `id: str`, `symbol: str`, `company_name?: str`, `image?: str`, `date?: str`, `headline?: str`, `title?: str`, `summary?: str`, `original_summary?: str`, `tags: str[]`, `category?: str`, `related_categories: str[]`, `descriptor?: str`, `important: bool=false`, `imp_announcement: bool=false`, `research_marked_important?: bool`, `duplicate: bool=false`, `attachment?: Attachment`, `attachment_url?: str`, `r2_key?: str`, `pdf_r2_key?: str`, `sources: Source[]` |
| `AnnouncementDetail` | all `AnnouncementSummary` fields plus `full_summary?: str`, `metadata?: AnnouncementMetadata`, `is_earnings?: bool`, `earnings_significant?: bool`, `management_guidance?: str` |
| `AnnouncementBatchResponse` | `data: AnnouncementDetail[]`, `missing_ids: str[]=[]` |
| `StringListResponse` | `data: str[]` |

### Symbol Metadata Schemas

| Schema | Fields |
|---|---|
| `SymbolMetadataItem` | `symbol: str`, `company_name?: str`, `logo?: str`, `market_cap?: float|int`, `sector?: str`, `basic_industry?: str`, `industry?: str`, `macro_economic_indicator?: str`, `theme?: str`, `scrip_code?: str` |
| `SymbolMetadataResponse` | `data: SymbolMetadataItem[]` |

Recommended frontend type:

```ts
export interface AlphaSymbolMetadata {
  symbol: string;
  company_name?: string | null;
  logo?: string | null;
  market_cap?: number | null;
  sector?: string | null;
  basic_industry?: string | null;
  industry?: string | null;
  macro_economic_indicator?: string | null;
  theme?: string | null;
  scrip_code?: string | null;
}
```

### File/Attachment Schemas

| Schema | Fields |
|---|---|
| `PresignedUrlResponse` | `url: str`, `expires_in?: int` |
| `AttachmentLookupItem` | `id: str`, `status: str`, `url?: str`, `expires_in?: int`, `message?: str` |
| `BatchAttachmentLookupResponse` | `data: AttachmentLookupItem[]` |

Attachment lookup statuses used by code include `ready`, `invalid_id`, `not_found`, `no_attachment`, and `no_transcript`.

### Daily Summary Schemas

| Schema | Fields |
|---|---|
| `PortfolioItem` | `symbol: str`, `exposure: float=0.0` |
| `SummaryRequest` | `portfolio: PortfolioItem[]` |
| `SummaryDetails` | `portfolio_size: int`, `symbols_processed: int`, `request_id: str` |
| `SummaryResponse` | `status: str`, `summary?: str`, `details?: SummaryDetails`, `error?: str` |
| `SummaryPoint` | internal LLM/context model with `symbol_key: str`, `symbols: str[]`, `category: "news"|"announcement"|"event"|"market_update"`, `headline: str`, `summary: str`, `is_update: bool=false` |

### Batch Summary Schemas

| Schema | Fields |
|---|---|
| `RequestCounts` | `total: int=0`, `completed: int=0`, `failed: int=0` |
| `BatchJobResponse` | `id: str`, `object: "batch"`, `display_name?: str`, `status: str`, `created_at: int`, `in_progress_at?: int`, `completed_at?: int`, `failed_at?: int`, `cancelled_at?: int`, `request_counts: RequestCounts`, `metadata?: object` |
| `BatchJobListItem` | `id: str`, `object: "batch"`, `display_name?: str`, `status: str`, `created_at: int` |
| `BatchJobListResponse` | `object: "list"`, `data: BatchJobListItem[]` |
| `BatchJobCancelResponse` | `id: str`, `status: "cancelled"` |

### API Key Schemas

| Schema | Fields |
|---|---|
| `ApiKeyStatus` | enum: `active`, `disabled`, `deleted` |
| `FieldError` | `field: str`, `message: str`, `code: str` |
| `ErrorBody` | `code: str`, `message: str`, `details?: FieldError[]`, `trace_id?: str` |
| `ErrorEnvelope` | `error: ErrorBody` |
| `MetaPage` | `total: int`, `page: int`, `per_page: int`, `total_pages: int`, `has_next: bool` |
| `LinksPage` | `self: str`, `next?: str`, `last: str` |
| `ApiKeyPayload` | `api_key: str`, `account_id?: str`, `user_id: str`, `status: ApiKeyStatus`, `rpm?: int`, `daily?: int`, `apis: str[]|"*"`, `ws_channels: str[]|"*"`, `issued_at: datetime`, `updated_at: datetime`, `deleted_at?: datetime` |
| `ApiKeyCreateRequest` | `account_id: str`, `user_id: str`, `status: ApiKeyStatus=active`, `rpm?: int`, `daily?: int`, `apis: str[]|"*"="*"`, `ws_channels: str[]|"*"="*"` |
| `ApiKeyPatchRequest` | `user_id?: str`, `status?: ApiKeyStatus`, `rpm?: int`, `daily?: int`, `apis?: str[]|"*"`, `ws_channels?: str[]|"*"` |
| `ApiKeyCreateResponse` | `data: ApiKeyPayload` |
| `ApiKeyGetResponse` | `data: ApiKeyPayload` |
| `ApiKeyDeleteResponse` | `data: object` |
| `ApiKeyListResponse` | `data: ApiKeyPayload[]`, `meta: MetaPage`, `links?: LinksPage` |
| `MigrateResponse` | `data: Record<string,int>` |
| `CacheClearResponse` | `data: Record<string,int>` |
| `UsagePoint` | `bucket: str`, `count: int` |
| `UsageResponse` | `data: { usage: UsagePoint[] }` in endpoint output; model is `dict[str, list[UsagePoint]]` |

Scope validation: `apis`, `ws_channels`, `allowed_products`, and `allowed_ws_products` accept `"*"` or a list of alphanumeric/underscore/hyphen scope names.

### Account/Admin Schemas

| Schema | Fields |
|---|---|
| `ProductEntitlement` | `product: str`, `enabled: bool=true`, `rpm?: int`, `daily?: int` |
| `WebsocketAddonEntitlement` | `product: str`, `enabled: bool=true`, `tier: str="basic_500"` |
| `AccountCreateRequest` | `account_id: str`, `name?: str`, `status: str="active"`, `initial_credits: int=0`, `products: ProductEntitlement[]`, `websocket_addons: WebsocketAddonEntitlement[]`, `metadata: object={}` |
| `AccountUpdateRequest` | `name?: str`, `status?: str`, `products?: ProductEntitlement[]`, `websocket_addons?: WebsocketAddonEntitlement[]`, `metadata?: object` |
| `CreditAdjustmentRequest` | `amount: int`, `reference_id: str`, `reason: str`, `metadata: object={}` |
| `ApiKeyAdminCreateRequest` | `account_id: str`, `user_id: str`, `status: str="active"`, `rpm?: int`, `daily?: int`, `allowed_products: str[]|"*"="*"`, `allowed_ws_products: str[]|"*"="*"` |
| `ApiKeyAdminPatchRequest` | `user_id?: str`, `status?: str`, `rpm?: int`, `daily?: int`, `allowed_products?: str[]|"*"`, `allowed_ws_products?: str[]|"*"` |
| `LedgerEntry` | `entry_id: str`, `account_id: str`, `api_key?: str`, `entry_type: str`, `amount: int`, `balance_after?: int`, `reference_id?: str`, `route_id?: str`, `metadata: object={}`, `created_at: datetime` |
| `AccountResponse` | `account_id: str`, `name?: str`, `status: str`, `balance: int`, `products: ProductEntitlement[]`, `websocket_addons: WebsocketAddonEntitlement[]`, `metadata: object={}`, `created_at?: datetime`, `updated_at?: datetime` |
| `AccountUsageResponse` | `account_id: str`, `balance: int`, `debited_today: int`, `live_usage: Record<string,int>`, `rate_limits: Record<string,Record<string,int>>`, `reserved: int=0` |
| `AccountDetailResponse` | `data: AccountResponse` |
| `AccountListResponse` | `data: AccountResponse[]` |
| `AccountUsageEnvelope` | `data: AccountUsageResponse` |
| `LedgerListResponse` | `data: LedgerEntry[]` |
| `ApiKeyAdminPayload` | `api_key: str`, `account_id: str`, `user_id: str`, `status: str`, `rpm?: int`, `daily?: int`, `allowed_products: str[]|"*"`, `allowed_ws_products: str[]|"*"`, `issued_at: datetime`, `updated_at: datetime`, `deleted_at?: datetime` |
| `ApiKeyAdminListResponse` | `data: ApiKeyAdminPayload[]` |
| `UsageHistoryPoint` | `bucket_date: str`, `api_key?: str`, `route_id?: str`, `request_count: int`, `credits_debited: int` |
| `UsageHistoryEnvelope` | `data: object` |
| `AdminApiKeyDetail` | `api_key: ApiKeyAdminPayload`, `live_usage: Record<string,int>`, `usage_history: UsageHistoryPoint[]`, `recent_ledger: LedgerEntry[]` |
| `AdminApiKeyDetailResponse` | `data: AdminApiKeyDetail` |
| `AdminAccountDashboard` | `account: AccountResponse`, `api_keys: ApiKeyAdminPayload[]`, `usage_history: UsageHistoryPoint[]`, `recent_ledger: LedgerEntry[]` |
| `AdminAccountDashboardResponse` | `data: AdminAccountDashboard` |

### Legacy/Domain Account Schemas

These are declared in `app/models/domain/account.py` but are not the primary response models for current account routes.

| Schema | Fields |
|---|---|
| `AccountInfo` | `status: str`, `limits: object`, `user_id?: str`, `issued_at?: str`, `updated_at?: str` |
| `UsageInfo` | `daily: int`, `remaining_daily: int` |

### Internal Runtime/Webhook Schemas

Internal runtime and webhook routes do not declare strict Pydantic response bodies. The code returns:

- Runtime audit: `{ data: <runtime inspection object> }`
- Internal webhooks: `{ status: "ok" }`
- Webhook request body: arbitrary JSON object, passed through to Redis pub/sub.

## Frontend Type Recommendations

Call Alpha API from frontend server actions only. Client components should import typed server actions from `frontend/service/actions/alpha.ts`, and those actions should read:

- `MANASIJA_API_BASE_URL`, defaulting to `https://developers.manasija.in`
- `MANASIJA_API_KEY`, sent as the `X-API-Key` header

Do not call `https://developers.manasija.in` directly from browser/client code. Do not route Alpha through the Market Stack backend unless the architecture changes again. The frontend has two separate server-side targets:

| Target | Env | Used for |
|---|---|---|
| Market Stack backend | `NEXT_PUBLIC_API_BASE_URL` | Broker accounts, watchlists, alerts, system config, LLM config |
| Manasija Alpha API | `MANASIJA_API_BASE_URL`, `MANASIJA_API_KEY` | Paid market intelligence data from `developers.manasija.in` |

Current first-class Alpha frontend actions:

| Action | Upstream Alpha route | Frontend consumer |
|---|---|---|
| `getAlphaSymbolMetadata` | `/v1/symbols/metadata` | Watchlists, alert picker, dashboard, company header |
| `getAlphaNews` | `/v1/news` | Dashboard, watchlist detail |
| `getAlphaAnnouncements` | `/v1/announcements` | Company detail, watchlist events |
| `getAlphaEarnings` | `/v1/earnings` | Company detail, earnings calendar |
| `getAlphaConcalls` | `/v1/concalls` | Company detail, research workspace |
| `getAlphaAlerts` | `/v1/alerts` | Alert center, dashboard |

## Implementation Notes For Market Stack

- `MANASIJA_API_KEY` is a paid customer key and should stay server-side through the backend System Config store.
- Frontend client components should never receive the raw key.
- Read-time metadata enrichment is safer than storing Alpha symbol metadata in local watchlist tables because company/sector/logo can change.
- Cache symbol metadata server-side later if calls become expensive. A 24 hour TTL is reasonable for company/sector/logo fields.
- Batch calls to `/v1/symbols/metadata` in groups of 20 symbols.
- On Alpha API failure, render local broker symbol data and show metadata as missing rather than blocking primary workflows.
