from fastapi import APIRouter

from app.api.v1 import (
    alert_channels,
    alert_notifications,
    alert_templates,
    alert_workflows,
    broker_accounts,
    broker_ops,
    health,
    live_streams,
    meta,
    notifications,
    users,
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
    alert_templates.router, prefix="/alert-templates", tags=["alert-templates"]
)
api_router.include_router(
    alert_channels.router, prefix="/alert-channels", tags=["alert-channels"]
)
api_router.include_router(
    live_streams.router, prefix="/live-streams", tags=["live-streams"]
)
api_router.include_router(
    broker_accounts.router, prefix="/broker-accounts", tags=["broker-accounts"]
)
api_router.include_router(
    broker_ops.router, prefix="/broker-accounts", tags=["broker-operations"]
)
