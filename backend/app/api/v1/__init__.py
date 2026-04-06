from fastapi import APIRouter

from app.api.v1 import broker_accounts, broker_ops, health, meta, notifications, users

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(meta.router, tags=["meta"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)
api_router.include_router(
    broker_accounts.router, prefix="/broker-accounts", tags=["broker-accounts"]
)
api_router.include_router(
    broker_ops.router, prefix="/broker-accounts", tags=["broker-operations"]
)
