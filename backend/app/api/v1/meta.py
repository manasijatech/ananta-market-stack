from fastapi import APIRouter

from app.schemas.broker import supported_brokers

router = APIRouter()


@router.get("/brokers/supported")
def brokers_supported() -> dict:
    """
    **List all brokers currently supported by the platform.**

    Returns an array of strings like `['zerodha', 'upstox', 'angel', ...]`.
    These codes are used as discriminators in the account creation payload.
    """
    return {"brokers": supported_brokers()}
