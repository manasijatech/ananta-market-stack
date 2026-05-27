from fastapi import APIRouter

from app.api.v1 import (
    alert_channels,
    alert_notifications,
    alert_presets,
    alert_runtime,
    alert_templates,
    alert_universes,
    alert_workflow_chat,
    alert_workflows,
    alpha_ws,
    broker_chat,
    broker_accounts,
    broker_data_config,
    broker_ops,
    health,
    live_streams,
    llm_usage,
    meta,
    notifications,
    system_config,
    users,
    watchlists,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(meta.router, tags=["meta"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)
api_router.include_router(
    alert_notifications.router, prefix="/alert-notifications", tags=["alert-notifications"]
)
api_router.include_router(
    alert_workflows.router, prefix="/alert-workflows", tags=["alert-workflows"]
)
api_router.include_router(
    alert_workflow_chat.router, prefix="/alert-workflow-chat", tags=["alert-workflow-chat"]
)
api_router.include_router(
    alert_templates.router, prefix="/alert-templates", tags=["alert-templates"]
)
api_router.include_router(
    alert_universes.router, prefix="/alert-universes", tags=["alert-universes"]
)
api_router.include_router(
    alert_presets.router, prefix="/alert-presets", tags=["alert-presets"]
)
api_router.include_router(
    alert_runtime.router, prefix="/alert-runtime", tags=["alert-runtime"]
)
api_router.include_router(
    alert_channels.router, prefix="/alert-channels", tags=["alert-channels"]
)
api_router.include_router(
    live_streams.router, prefix="/live-streams", tags=["live-streams"]
)
api_router.include_router(
    alpha_ws.router, prefix="/alpha", tags=["alpha-websocket"]
)
api_router.include_router(
    watchlists.router, prefix="/watchlists", tags=["watchlists"]
)
api_router.include_router(
    broker_accounts.router, prefix="/broker-accounts", tags=["broker-accounts"]
)
api_router.include_router(
    broker_data_config.router, prefix="/broker-data", tags=["broker-data"]
)
api_router.include_router(
    broker_chat.router, prefix="/broker-chat", tags=["broker-chat"]
)
api_router.include_router(
    system_config.router, prefix="/system-config", tags=["system-config"]
)
api_router.include_router(
    llm_usage.router, prefix="/llm-usage", tags=["llm-usage"]
)
api_router.include_router(
    broker_ops.router, prefix="/broker-accounts", tags=["broker-operations"]
)
