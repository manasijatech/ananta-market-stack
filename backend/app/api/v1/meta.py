from fastapi import APIRouter

from app.schemas.broker import supported_brokers
from app.schemas.system_config import FeatureFlagsOut
from app.services import feature_flags

router = APIRouter()


@router.get("/features", response_model=FeatureFlagsOut)
def get_features() -> FeatureFlagsOut:
    """Public runtime feature flags for this instance. Not baked into the frontend image."""
    return FeatureFlagsOut(adaptive_workspace=feature_flags.adaptive_workspace_enabled())


@router.get("/brokers/supported")
def brokers_supported() -> dict:
    """
    **List all brokers currently supported by the platform.**

    Returns an array of strings like `['zerodha', 'upstox', 'angel', ...]`.
    These codes are used as discriminators in the account creation payload.
    """
    return {"brokers": supported_brokers()}
