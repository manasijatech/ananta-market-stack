# LLM provider configuration

Market Stack supports three user-configurable LLM providers:

- `openai`
- `openrouter`
- `gemini`

All three are accessed through the Python `openai` SDK. Provider differences are
limited to:

- the stored API key
- the provider-specific base URL
- optional OpenRouter attribution headers

## Stored data

### Provider credentials

Encrypted provider credentials are stored in `user_llm_provider_credentials`.

Important fields:

- `provider`
- `api_key_cipher`
- `is_enabled`

The API key is encrypted at rest with the same Fernet-based credential helpers
used for broker credentials.

Read APIs do not return the raw API key. They expose only:

- `has_api_key`
- `api_key_updated_at`
- `api_key_hint`

`api_key_hint` is a short masked suffix-only clue meant for UI display after
reloads. Replacing a key always requires submitting the full new key again.

### Saved models

User-selected provider models are stored in `user_llm_models`.

Important fields:

- `provider`
- `model_id`
- `label`
- `is_enabled`

These model rows are intended to be reused later by alert workflows and other
LLM-backed features.

## Reusable backend helpers

### `app/services/llm_config.py`

Use this module for configuration access and persistence.

Key functions:

- `provider_definitions()`
- `list_provider_configs(db, user_id)`
- `upsert_provider_credential(db, user_id, provider, payload)`
- `add_provider_model(db, user_id, payload)`
- `delete_provider_model(db, user_id, model_row_id)`
- `get_provider_api_key(db, user_id, provider)`

### `app/services/llm_gateway.py`

Use this module for actual provider-aware SDK calls.

Key functions:

- `build_provider_client(db, user_id, provider)`
- `generate_text(...)`
- `generate_text_response_api(...)`
- `build_text_part(text)`
- `build_file_part(filename, mime_type, data)`
- `build_user_message_content(text=..., files=...)`

`generate_text(...)` is the current cross-provider default because OpenRouter and
Gemini both document OpenAI-compatible chat-completions support. The Responses
API helper is also available for newer OpenAI-first workflows.

## System config API

User-facing configuration is exposed from `app/api/v1/system_config.py`.

Current routes:

- `GET /api/v1/system-config`
- `GET /api/v1/system-config/broker-search`
- `PUT /api/v1/system-config/broker-search`
- `GET /api/v1/system-config/instruments/search`
- `GET /api/v1/system-config/llm/providers`
- `PUT /api/v1/system-config/llm/providers/{provider}`
- `DELETE /api/v1/system-config/llm/providers/{provider}`
- `POST /api/v1/system-config/llm/models`
- `DELETE /api/v1/system-config/llm/models/{model_row_id}`

## Provider notes

### OpenAI

- Base URL: `https://api.openai.com/v1`
- Preferred for new OpenAI-native Responses API workflows

### OpenRouter

- Base URL: `https://openrouter.ai/api/v1`
- Uses the OpenAI SDK with `base_url` override
- Optional `HTTP-Referer` and `X-OpenRouter-Title` headers are attached when
  `APP_PUBLIC_BASE_URL` is configured

### Gemini

- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`
- Uses Gemini's OpenAI-compatible API surface through the OpenAI SDK
- Inline file prompts should use base64 file parts, which aligns well with the
  reusable helpers in `llm_gateway.py`
