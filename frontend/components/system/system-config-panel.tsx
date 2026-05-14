"use client";

import { useState, useTransition } from "react";
import {
  addLlmProviderModel,
  deleteAlphaApiCredential,
  deleteLlmProviderCredential,
  deleteLlmProviderModel,
  updateBrokerDataSearchConfig,
  updateAlphaWebSocketConfig,
  upsertAlphaApiCredential,
  upsertLlmProviderCredential
} from "@/service/actions/broker";
import { parseActionError } from "@/components/brokers/action-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LlmProvider, SystemConfig } from "@/service/types/broker";

type ProviderDraftState = {
  apiKey: string;
  modelId: string;
  label: string;
  replacingApiKey: boolean;
};

function providerKey(provider: LlmProvider) {
  return provider;
}

export function SystemConfigPanel({
  initialConfig
}: {
  initialConfig: SystemConfig;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [selectedAccountId, setSelectedAccountId] = useState(initialConfig.broker_data_search.preferred_search_account_id ?? "");
  const [brokerError, setBrokerError] = useState("");
  const [alphaApiKey, setAlphaApiKey] = useState("");
  const [alphaWsConfig, setAlphaWsConfig] = useState(initialConfig.alpha_websocket);
  const [alphaReplacingApiKey, setAlphaReplacingApiKey] = useState(false);
  const [alphaError, setAlphaError] = useState("");
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, ProviderDraftState>>(
    Object.fromEntries(
      initialConfig.llm_providers.map((provider) => [
        provider.provider,
        { apiKey: "", modelId: "", label: "", replacingApiKey: false }
      ])
    )
  );
  const [isPending, startTransition] = useTransition();

  function updateDraft(provider: LlmProvider, patch: Partial<ProviderDraftState>) {
    setDrafts((current) => ({
      ...current,
      [providerKey(provider)]: {
        ...(current[providerKey(provider)] ?? { apiKey: "", modelId: "", label: "", replacingApiKey: false }),
        ...patch
      }
    }));
  }

  function displayedApiKeyValue(provider: SystemConfig["llm_providers"][number]) {
    const draft = drafts[providerKey(provider.provider)];
    if ((draft?.replacingApiKey ?? false) || (draft?.apiKey ?? "").trim()) {
      return draft?.apiKey ?? "";
    }
    return provider.api_key_hint ?? "";
  }

  function replaceProvider(provider: LlmProvider, nextProviderConfig: SystemConfig["llm_providers"][number]) {
    setConfig((current) => ({
      ...current,
      llm_providers: current.llm_providers.map((item) => (item.provider === provider ? nextProviderConfig : item))
    }));
  }

  function replaceProviders(nextProviders: SystemConfig["llm_providers"]) {
    setConfig((current) => ({
      ...current,
      llm_providers: nextProviders
    }));
  }

  function saveBrokerPreference() {
    setBrokerError("");
    startTransition(async () => {
      try {
        const next = await updateBrokerDataSearchConfig(selectedAccountId || null);
        setConfig((current) => ({ ...current, broker_data_search: next }));
      } catch (caught) {
        setBrokerError(parseActionError(caught).message);
      }
    });
  }

  function displayedAlphaApiKeyValue() {
    if (alphaReplacingApiKey || alphaApiKey.trim()) {
      return alphaApiKey;
    }
    return config.alpha_api.api_key_hint ?? "";
  }

  function saveAlphaApiKey() {
    setAlphaError("");
    startTransition(async () => {
      try {
        const next = await upsertAlphaApiCredential({ api_key: alphaApiKey });
        setConfig((current) => ({ ...current, alpha_api: next }));
        setAlphaApiKey("");
        setAlphaReplacingApiKey(false);
      } catch (caught) {
        setAlphaError(parseActionError(caught).message);
      }
    });
  }

  function clearAlphaApiKey() {
    setAlphaError("");
    startTransition(async () => {
      try {
        const next = await deleteAlphaApiCredential();
        setConfig((current) => ({ ...current, alpha_api: next }));
        setAlphaApiKey("");
        setAlphaReplacingApiKey(false);
      } catch (caught) {
        setAlphaError(parseActionError(caught).message);
      }
    });
  }

  function toggleAlphaWsProduct(product: string, checked: boolean) {
    setAlphaWsConfig((current) => ({
      ...current,
      products: checked
        ? Array.from(new Set([...current.products, product]))
        : current.products.filter((item) => item !== product)
    }));
  }

  function saveAlphaWsConfig() {
    setAlphaError("");
    startTransition(async () => {
      try {
        const next = await updateAlphaWebSocketConfig({
          is_enabled: alphaWsConfig.is_enabled,
          products: alphaWsConfig.products,
          scope_mode: alphaWsConfig.scope_mode,
          watchlist_ids: alphaWsConfig.watchlist_ids,
          include_all_watchlists: alphaWsConfig.include_all_watchlists,
          full_market: alphaWsConfig.full_market
        });
        setAlphaWsConfig(next);
      } catch (caught) {
        setAlphaError(parseActionError(caught).message);
      }
    });
  }

  function saveProviderApiKey(provider: LlmProvider) {
    setProviderErrors((current) => ({ ...current, [provider]: "" }));
    startTransition(async () => {
      try {
        const next = await upsertLlmProviderCredential(provider, {
          api_key: drafts[providerKey(provider)]?.apiKey ?? ""
        });
        replaceProvider(provider, next);
        updateDraft(provider, { apiKey: "", replacingApiKey: false });
      } catch (caught) {
        setProviderErrors((current) => ({ ...current, [provider]: parseActionError(caught).message }));
      }
    });
  }

  function clearProviderApiKey(provider: LlmProvider) {
    setProviderErrors((current) => ({ ...current, [provider]: "" }));
    startTransition(async () => {
      try {
        const next = await deleteLlmProviderCredential(provider);
        replaceProviders(next);
        updateDraft(provider, { apiKey: "", replacingApiKey: false });
      } catch (caught) {
        setProviderErrors((current) => ({ ...current, [provider]: parseActionError(caught).message }));
      }
    });
  }

  function addModel(provider: LlmProvider) {
    setProviderErrors((current) => ({ ...current, [provider]: "" }));
    startTransition(async () => {
      try {
        const next = await addLlmProviderModel({
          provider,
          model_id: drafts[providerKey(provider)]?.modelId ?? "",
          label: drafts[providerKey(provider)]?.label || null
        });
        replaceProviders(next);
        updateDraft(provider, { modelId: "", label: "" });
      } catch (caught) {
        setProviderErrors((current) => ({ ...current, [provider]: parseActionError(caught).message }));
      }
    });
  }

  function removeModel(provider: LlmProvider, modelRowId: string) {
    setProviderErrors((current) => ({ ...current, [provider]: "" }));
    startTransition(async () => {
      try {
        const next = await deleteLlmProviderModel(modelRowId);
        replaceProviders(next);
      } catch (caught) {
        setProviderErrors((current) => ({ ...current, [provider]: parseActionError(caught).message }));
      }
    });
  }

  return (
    <div className="grid gap-8">
      <section className="rounded-lg border border-border p-5">
        <div className="text-sm font-bold">Default symbol-search broker</div>
        <p className="mt-2 text-sm text-muted-foreground">
          The selected broker cache is used first for symbol search. If it is unavailable, search falls back to the next available synced broker without blocking the UI.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            className="h-10 min-w-[280px] rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) => setSelectedAccountId(event.target.value)}
            value={selectedAccountId}
          >
            {config.broker_data_search.accounts.map((account) => (
              <option key={account.account_id} value={account.account_id}>
                {account.label} · {account.broker_code}
              </option>
            ))}
          </select>
          <Button disabled={isPending} onClick={saveBrokerPreference} type="button">
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
        {config.broker_data_search.effective_search_account_id ? (
          <div className="mt-4 text-xs text-muted-foreground">
            Effective search account: {config.broker_data_search.accounts.find((item) => item.account_id === config.broker_data_search.effective_search_account_id)?.label ?? config.broker_data_search.effective_search_account_id}
            {config.broker_data_search.fallback_used ? " · fallback active right now" : ""}
          </div>
        ) : null}
        {brokerError ? <div className="mt-3 text-sm text-destructive">{brokerError}</div> : null}
      </section>

      <section className="grid gap-3">
        <div className="text-sm font-bold">Broker data status</div>
        {config.broker_data_search.accounts.map((account) => (
          <div className="rounded-lg border border-border p-4" key={account.account_id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold">
                  {account.label} · {account.broker_code}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {account.search_available ? "Search cache ready" : "Search cache unavailable"} · {account.is_verified ? "verified" : "unverified"} · {account.session_active ? "session active" : (account.session_status ?? "session pending")}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {account.is_preferred ? "preferred" : account.is_effective ? "effective fallback" : "standby"}
              </div>
            </div>
            <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
              <div>
                Instrument sync: {account.latest_instrument_sync_status ?? "not run"}{account.latest_instrument_sync_finished_at ? ` · ${new Date(account.latest_instrument_sync_finished_at).toLocaleString("en-IN")}` : ""}
              </div>
              <div>
                Holdings refresh: {account.holdings_status ?? "not run"} · {account.holdings_count} items{account.holdings_fetched_at ? ` · ${new Date(account.holdings_fetched_at).toLocaleString("en-IN")}` : ""}
              </div>
              {account.last_error ? <div className="text-amber-700 dark:text-amber-300">{account.last_error}</div> : null}
              {account.latest_instrument_sync_error ? <div className="text-amber-700 dark:text-amber-300">{account.latest_instrument_sync_error}</div> : null}
            </div>
          </div>
        ))}
        {!config.broker_data_search.accounts.length ? <div className="text-sm text-muted-foreground">No broker accounts available yet.</div> : null}
      </section>

      <section className="grid gap-4">
        <div>
          <div className="text-sm font-bold">Manasija Alpha API</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Store the Alpha API key used for market intelligence, company metadata, announcements, concalls, and daily summaries.
          </p>
        </div>
        <div className="rounded-lg border border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold">{config.alpha_api.label}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                API key {config.alpha_api.has_api_key ? "configured" : "not configured"}{config.alpha_api.api_key_updated_at ? ` · updated ${new Date(config.alpha_api.api_key_updated_at).toLocaleString("en-IN")}` : ""}
              </div>
              {config.alpha_api.api_key_hint ? (
                <div className="mt-1 text-xs text-muted-foreground">Saved key: {config.alpha_api.api_key_hint}</div>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-3 min-[760px]:flex-row">
            <Input
              className="min-[760px]:max-w-xl"
              onChange={(event) => setAlphaApiKey(event.target.value)}
              placeholder={config.alpha_api.has_api_key ? "Replace saved Manasija Alpha API key" : "Add Manasija Alpha API key"}
              type={alphaReplacingApiKey || !config.alpha_api.has_api_key ? "password" : "text"}
              value={displayedAlphaApiKeyValue()}
              readOnly={config.alpha_api.has_api_key && !alphaReplacingApiKey}
            />
            <Button
              disabled={isPending || !alphaApiKey.trim()}
              onClick={saveAlphaApiKey}
              type="button"
            >
              Save key
            </Button>
            <Button
              disabled={isPending}
              onClick={() => {
                setAlphaApiKey("");
                setAlphaReplacingApiKey(true);
              }}
              type="button"
              variant="outline"
            >
              {config.alpha_api.has_api_key ? "Replace key" : "Enter key"}
            </Button>
            <Button
              disabled={isPending || !config.alpha_api.has_api_key}
              onClick={clearAlphaApiKey}
              type="button"
              variant="ghost"
            >
              Clear key
            </Button>
          </div>
          {alphaError ? <div className="mt-3 text-sm text-destructive">{alphaError}</div> : null}
        </div>
        <div className="rounded-lg border border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold">Backend websocket worker</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {alphaWsConfig.status} · {alphaWsConfig.effective_products.length} products · {alphaWsConfig.scope_mode === "full_market" ? "full market" : `${alphaWsConfig.effective_symbols.length} symbols`}
              </div>
            </div>
            <Button disabled={isPending} onClick={saveAlphaWsConfig} type="button" variant="outline">
              Save websocket products
            </Button>
          </div>
          <div className="mt-4 grid gap-2 min-[760px]:grid-cols-2">
            {alphaWsConfig.entitled_addons.filter((addon) => addon.enabled).map((addon) => (
              <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm" key={addon.product}>
                <span>{addon.product} · {addon.tier ?? "tier unknown"}</span>
                <input checked={alphaWsConfig.products.includes(addon.product)} onChange={(event) => toggleAlphaWsProduct(addon.product, event.target.checked)} type="checkbox" />
              </label>
            ))}
          </div>
          {config.alpha_api.account_error ? <div className="mt-3 text-sm text-destructive">{config.alpha_api.account_error}</div> : null}
          {alphaWsConfig.last_error ? <div className="mt-3 text-sm text-destructive">{alphaWsConfig.last_error}</div> : null}
        </div>
      </section>

      <section className="grid gap-4">
        <div>
          <div className="text-sm font-bold">LLM providers</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Configure OpenAI, OpenRouter, or Gemini API keys and save one or more models per provider. All provider calls in the backend are routed through the OpenAI SDK with provider-specific base URLs.
          </p>
        </div>
        {config.llm_providers.map((provider) => (
          <div className="rounded-lg border border-border p-5" key={provider.provider}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold">{provider.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{provider.base_url}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  API key {provider.has_api_key ? "configured" : "not configured"}{provider.api_key_updated_at ? ` · updated ${new Date(provider.api_key_updated_at).toLocaleString("en-IN")}` : ""}
                </div>
                {provider.api_key_hint ? (
                  <div className="mt-1 text-xs text-muted-foreground">Saved key: {provider.api_key_hint}</div>
                ) : null}
              </div>
              {provider.documentation_url ? (
                <a
                  className="text-xs font-semibold text-primary hover:underline"
                  href={provider.documentation_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Docs
                </a>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 min-[900px]:grid-cols-[1.4fr_auto_auto_auto]">
              <Input
                onChange={(event) => updateDraft(provider.provider, { apiKey: event.target.value })}
                placeholder={provider.has_api_key ? "Replace saved API key" : `Add ${provider.label} API key`}
                type="password"
                value={displayedApiKeyValue(provider)}
                readOnly={provider.has_api_key && !(drafts[providerKey(provider.provider)]?.replacingApiKey ?? false)}
              />
              <Button
                disabled={isPending || !(drafts[providerKey(provider.provider)]?.apiKey ?? "").trim()}
                onClick={() => saveProviderApiKey(provider.provider)}
                type="button"
              >
                Save key
              </Button>
              <Button
                disabled={isPending}
                onClick={() => updateDraft(provider.provider, { apiKey: "", replacingApiKey: true })}
                type="button"
                variant="outline"
              >
                {provider.has_api_key ? "Replace key" : "Enter key"}
              </Button>
              <Button
                disabled={isPending || !provider.has_api_key}
                onClick={() => clearProviderApiKey(provider.provider)}
                type="button"
                variant="outline"
              >
                Clear key
              </Button>
            </div>

            <div className="mt-5 grid gap-3 min-[900px]:grid-cols-[1.1fr_1fr_auto]">
              <Input
                onChange={(event) => updateDraft(provider.provider, { modelId: event.target.value })}
                placeholder="Model id"
                value={drafts[providerKey(provider.provider)]?.modelId ?? ""}
              />
              <Input
                onChange={(event) => updateDraft(provider.provider, { label: event.target.value })}
                placeholder="Optional label"
                value={drafts[providerKey(provider.provider)]?.label ?? ""}
              />
              <Button
                disabled={isPending || !(drafts[providerKey(provider.provider)]?.modelId ?? "").trim()}
                onClick={() => addModel(provider.provider)}
                type="button"
                variant="outline"
              >
                Add model
              </Button>
            </div>

            <div className="mt-4 grid gap-2">
              <div className="text-xs font-bold uppercase text-muted-foreground">Saved models</div>
              {provider.models.map((model) => (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2" key={model.id}>
                  <div>
                    <div className="text-sm font-semibold">{model.model_id}</div>
                    <div className="text-xs text-muted-foreground">
                      {model.label || "No custom label"} · saved {new Date(model.created_at).toLocaleString("en-IN")}
                    </div>
                  </div>
                  <Button onClick={() => removeModel(provider.provider, model.id)} size="sm" type="button" variant="ghost">
                    Remove
                  </Button>
                </div>
              ))}
              {!provider.models.length ? <div className="text-sm text-muted-foreground">No models saved yet.</div> : null}
            </div>

            {providerErrors[provider.provider] ? <div className="mt-3 text-sm text-destructive">{providerErrors[provider.provider]}</div> : null}
          </div>
        ))}
      </section>
    </div>
  );
}
