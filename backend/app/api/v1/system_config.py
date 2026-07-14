from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.deps import get_current_principal, get_current_user
from app.schemas.broker import (
    BrokerDataDefaultConfigUpdateIn,
    BrokerDataSearchConfigUpdateIn,
    InstrumentSearchRow,
)
from app.schemas.system_config import (
    AlphaApiConfigOut,
    AlphaApiCredentialUpsertIn,
    AlphaApiKeyOut,
    AlphaWebSocketConfigOut,
    AlphaWebSocketConfigUpdateIn,
    LlmModelCreateIn,
    LlmModelPricingOut,
    LlmModelPricingUpsertIn,
    LlmProvider,
    LlmProviderConfigOut,
    LlmProviderCredentialUpsertIn,
    McpInventoryRefreshOut,
    McpOAuthCompleteIn,
    McpOAuthStartIn,
    McpOAuthStartOut,
    McpServerConfigOut,
    McpServerConfigUpdateIn,
    SystemConfigOut,
)
from app.services import alpha_config
from app.services import alpha_websocket
from app.services import broker_data_preferences
from app.services import llm_config
from app.services import mcp_config
from app.services import rbac
from app.services.rbac import Principal
from db.models import User
from db.session import get_db

router = APIRouter()


def _mcp_read_allowed(principal: Principal) -> bool:
    return rbac.has_workspace_permission(principal, rbac.SETTINGS_USE_MCP) or rbac.has_workspace_permission(
        principal, rbac.SETTINGS_MANAGE_MCP
    )


@router.get("", response_model=SystemConfigOut)
def get_system_config(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> SystemConfigOut:
    mcp_server = McpServerConfigOut()
    mcp_servers: list[McpServerConfigOut] = []
    mcp_connector_readiness = []
    if _mcp_read_allowed(principal):
        mcp_server = mcp_config.get_mcp_server_config(db, principal.user.id)
        mcp_servers = mcp_config.list_mcp_server_configs(db, principal.user.id)
        mcp_connector_readiness = mcp_config.list_mcp_connector_readiness()
    return SystemConfigOut(
        broker_data_default=broker_data_preferences.get_broker_data_default_config(db, principal.user.id, principal),
        broker_data_search=broker_data_preferences.get_broker_data_search_config(db, principal.user.id, principal),
        llm_providers=llm_config.list_provider_configs(db, principal.user.id),
        llm_model_pricing=llm_config.list_model_pricing(db, principal.user.id),
        alpha_api=alpha_config.get_alpha_api_config(db, principal.user.id),
        alpha_websocket=alpha_websocket.alpha_ws_config_out(db, principal.user.id),
        mcp_server=mcp_server,
        mcp_servers=mcp_servers,
        mcp_connector_readiness=mcp_connector_readiness,
    )


@router.get("/broker-search")
def get_broker_search_config(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
):
    return broker_data_preferences.get_broker_data_search_config(db, principal.user.id, principal)


@router.get("/broker-default")
def get_broker_default_config(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
):
    return broker_data_preferences.get_broker_data_default_config(db, principal.user.id, principal)


@router.put("/broker-default")
def update_broker_default_config(
    body: BrokerDataDefaultConfigUpdateIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
):
    try:
        return broker_data_preferences.update_broker_data_default_config(db, principal.user.id, body, principal)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/broker-search")
def update_broker_search_config(
    body: BrokerDataSearchConfigUpdateIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
):
    try:
        return broker_data_preferences.update_broker_data_search_config(db, principal.user.id, body, principal)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/alpha", response_model=AlphaApiConfigOut)
def get_alpha_api_config(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AlphaApiConfigOut:
    return alpha_config.get_alpha_api_config(db, principal.user.id)


@router.put("/alpha", response_model=AlphaApiConfigOut)
def upsert_alpha_api_credential(
    body: AlphaApiCredentialUpsertIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AlphaApiConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_ALPHA)
    try:
        return alpha_config.upsert_alpha_api_credential(db, principal.user.id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/alpha", response_model=AlphaApiConfigOut)
def delete_alpha_api_credential(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AlphaApiConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_ALPHA)
    return alpha_config.delete_alpha_api_credential(db, principal.user.id)


@router.get("/alpha/websocket", response_model=AlphaWebSocketConfigOut)
def get_alpha_websocket_config(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlphaWebSocketConfigOut:
    return alpha_websocket.alpha_ws_config_out(db, user.id)


@router.post("/alpha/websocket/refresh", response_model=AlphaWebSocketConfigOut)
def refresh_alpha_websocket_account(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlphaWebSocketConfigOut:
    try:
        asyncio.run(alpha_websocket.refresh_account_for_user(user.id))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not refresh Alpha account plan: {exc}") from exc
    return alpha_websocket.alpha_ws_config_out(db, user.id)


@router.put("/alpha/websocket", response_model=AlphaWebSocketConfigOut)
def update_alpha_websocket_config(
    body: AlphaWebSocketConfigUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AlphaWebSocketConfigOut:
    try:
        return alpha_websocket.update_alpha_ws_config(db, user.id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/alpha/key", response_model=AlphaApiKeyOut)
def get_alpha_api_key(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> AlphaApiKeyOut:
    try:
        return AlphaApiKeyOut(api_key=alpha_config.get_alpha_api_key(db, principal.user.id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/instruments/search", response_model=list[InstrumentSearchRow])
def search_instruments(
    q: str = Query(default=""),
    exchange: str | None = Query(default=None),
    segment: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[InstrumentSearchRow]:
    return broker_data_preferences.search_instruments_for_user(
        db,
        principal.user.id,
        query=q,
        exchange=exchange,
        segment=segment,
        limit=limit,
        principal=principal,
    )


@router.get("/llm/providers", response_model=list[LlmProviderConfigOut])
def list_llm_providers(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[LlmProviderConfigOut]:
    return llm_config.list_provider_configs(db, principal.user.id)


@router.put("/llm/providers/{provider}", response_model=LlmProviderConfigOut)
def upsert_llm_provider_credential(
    provider: LlmProvider,
    body: LlmProviderCredentialUpsertIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> LlmProviderConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_LLM)
    return llm_config.upsert_provider_credential(db, principal.user.id, provider, body)


@router.delete("/llm/providers/{provider}", response_model=list[LlmProviderConfigOut])
def delete_llm_provider_credential(
    provider: LlmProvider,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[LlmProviderConfigOut]:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_LLM)
    return llm_config.delete_provider_credential(db, principal.user.id, provider)


@router.post("/llm/models", response_model=list[LlmProviderConfigOut])
def add_llm_model(
    body: LlmModelCreateIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[LlmProviderConfigOut]:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_LLM)
    try:
        return llm_config.add_provider_model(db, principal.user.id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/llm/models/{model_row_id}", response_model=list[LlmProviderConfigOut])
def delete_llm_model(
    model_row_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[LlmProviderConfigOut]:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_LLM)
    return llm_config.delete_provider_model(db, principal.user.id, model_row_id)


@router.get("/llm/pricing", response_model=list[LlmModelPricingOut])
def list_llm_model_pricing(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[LlmModelPricingOut]:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_VIEW_LLM_USAGE)
    return llm_config.list_model_pricing(db, principal.user.id)


@router.put("/llm/pricing", response_model=LlmModelPricingOut)
def upsert_llm_model_pricing(
    body: LlmModelPricingUpsertIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> LlmModelPricingOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_LLM)
    return llm_config.upsert_model_pricing(db, principal.user.id, body)


@router.delete("/llm/pricing/{pricing_id}", response_model=list[LlmModelPricingOut])
def delete_llm_model_pricing(
    pricing_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[LlmModelPricingOut]:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_LLM)
    return llm_config.delete_model_pricing(db, principal.user.id, pricing_id)


@router.post("/llm/pricing/openrouter/refresh", response_model=list[LlmModelPricingOut])
def refresh_openrouter_llm_model_pricing(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[LlmModelPricingOut]:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_LLM)
    try:
        return llm_config.refresh_openrouter_model_pricing(db, principal.user.id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/mcp", response_model=McpServerConfigOut)
def get_mcp_server_config(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_active_member(principal)
    if not _mcp_read_allowed(principal):
        raise HTTPException(status_code=403, detail="MCP is not available for your workspace role.")
    return mcp_config.get_mcp_server_config(db, principal.user.id)


@router.get("/mcp/servers", response_model=list[McpServerConfigOut])
def list_mcp_server_configs(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[McpServerConfigOut]:
    rbac.require_active_member(principal)
    if not _mcp_read_allowed(principal):
        raise HTTPException(status_code=403, detail="MCP is not available for your workspace role.")
    return mcp_config.list_mcp_server_configs(db, principal.user.id)


@router.put("/mcp", response_model=McpServerConfigOut)
def update_mcp_server_config(
    body: McpServerConfigUpdateIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    try:
        return mcp_config.upsert_mcp_server_config(db, principal.user.id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/mcp/servers", response_model=McpServerConfigOut)
def create_mcp_server_config(
    body: McpServerConfigUpdateIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    try:
        return mcp_config.create_mcp_server_config(db, principal.user.id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/mcp/servers/{server_id}", response_model=McpServerConfigOut)
def update_mcp_server_config_by_id(
    server_id: str,
    body: McpServerConfigUpdateIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    try:
        return mcp_config.upsert_mcp_server_config(db, principal.user.id, body, server_id=server_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/mcp/key", response_model=McpServerConfigOut)
def clear_mcp_server_api_key(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    return mcp_config.clear_mcp_api_key(db, principal.user.id)


@router.delete("/mcp/servers/{server_id}/key", response_model=McpServerConfigOut)
def clear_mcp_server_api_key_by_id(
    server_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    return mcp_config.clear_mcp_server_api_key(db, principal.user.id, server_id)


@router.delete("/mcp", response_model=McpServerConfigOut)
def delete_mcp_server_config(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    return mcp_config.delete_mcp_server_config(db, principal.user.id)


@router.delete("/mcp/servers/{server_id}", response_model=McpServerConfigOut)
def delete_mcp_server_config_by_id(
    server_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    return mcp_config.delete_mcp_server_config_by_id(db, principal.user.id, server_id)


@router.post("/mcp/oauth/start", response_model=McpOAuthStartOut)
def start_mcp_oauth(
    body: McpOAuthStartIn | None = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpOAuthStartOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    try:
        return asyncio.run(
            mcp_config.start_mcp_oauth(
                db,
                principal.user.id,
                body.redirect_uri if body else None,
                body.server_id if body else None,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not start MCP authentication: {mcp_config.describe_exception(exc)}",
        ) from exc


@router.get("/mcp/oauth/callback", response_class=HTMLResponse)
def complete_mcp_oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    if error:
        return HTMLResponse(
            "<!doctype html><html><body style='font-family:sans-serif;max-width:640px;margin:40px auto;'>"
            "<h2>MCP authentication failed</h2>"
            f"<p>{error}</p>"
            "<p>You can close this tab and retry from Ananta Market Stack System Config.</p>"
            "</body></html>",
            status_code=400,
        )
    if not code or not state:
        return HTMLResponse(
            "<!doctype html><html><body style='font-family:sans-serif;max-width:640px;margin:40px auto;'>"
            "<h2>MCP authentication failed</h2>"
            "<p>The authorization server did not return both code and state.</p>"
            "</body></html>",
            status_code=400,
        )
    try:
        asyncio.run(mcp_config.complete_mcp_oauth(db, state, code))
    except Exception as exc:
        return HTMLResponse(
            "<!doctype html><html><body style='font-family:sans-serif;max-width:640px;margin:40px auto;'>"
            "<h2>MCP authentication failed</h2>"
            f"<p>{exc}</p>"
            "<p>You can close this tab and retry from Ananta Market Stack System Config.</p>"
            "</body></html>",
            status_code=400,
        )
    return HTMLResponse(
        "<!doctype html><html><body style='font-family:sans-serif;max-width:640px;margin:40px auto;'>"
        "<h2>MCP authentication complete</h2>"
        "<p>You can close this tab and return to Ananta Market Stack System Config.</p>"
        "</body></html>",
        status_code=200,
    )


@router.post("/mcp/oauth/complete", response_model=McpServerConfigOut)
def complete_mcp_oauth(
    body: McpOAuthCompleteIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    try:
        asyncio.run(mcp_config.complete_mcp_oauth(db, body.state, body.code, principal.user.id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not complete MCP authentication: {mcp_config.describe_exception(exc)}",
        ) from exc
    return mcp_config.get_mcp_server_config(db, principal.user.id)


@router.delete("/mcp/oauth", response_model=McpServerConfigOut)
def clear_mcp_oauth(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    return mcp_config.clear_mcp_oauth(db, principal.user.id)


@router.delete("/mcp/servers/{server_id}/oauth", response_model=McpServerConfigOut)
def clear_mcp_oauth_by_id(
    server_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpServerConfigOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    return mcp_config.clear_mcp_server_oauth(db, principal.user.id, server_id)


@router.post("/mcp/inventory/refresh", response_model=McpInventoryRefreshOut)
def refresh_mcp_inventory(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpInventoryRefreshOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    try:
        config = asyncio.run(mcp_config.refresh_mcp_inventory(db, principal.user.id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return McpInventoryRefreshOut(config=config, refreshed=True)


@router.post("/mcp/servers/{server_id}/inventory/refresh", response_model=McpInventoryRefreshOut)
def refresh_mcp_inventory_by_id(
    server_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> McpInventoryRefreshOut:
    rbac.require_workspace_permission(principal, rbac.SETTINGS_MANAGE_MCP)
    try:
        config = asyncio.run(mcp_config.refresh_mcp_inventory(db, principal.user.id, server_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return McpInventoryRefreshOut(config=config, refreshed=True)
