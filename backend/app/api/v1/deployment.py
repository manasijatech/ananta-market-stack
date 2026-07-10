from fastapi import APIRouter

from app.schemas.deployment import DeploymentUpdateStatusOut
from app.services.deployment_updates import get_deployment_update_status

router = APIRouter()


@router.get("/deployment/update-status", response_model=DeploymentUpdateStatusOut)
def deployment_update_status() -> DeploymentUpdateStatusOut:
    return get_deployment_update_status()
