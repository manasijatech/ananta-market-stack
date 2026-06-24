from datetime import datetime

from pydantic import BaseModel, Field


class DeploymentUpdateStatusOut(BaseModel):
    checks_enabled: bool
    update_available: bool
    running_version: str | None = None
    running_sha: str | None = None
    running_digest: str | None = None
    latest_digest: str | None = None
    image_repository: str
    image_tag: str
    last_checked_at: datetime | None = None
    last_check_error: str | None = None
    docker_image_update_docs_url: str = Field(
        default="https://github.com/manasijatech/ananta-market-stack/blob/main/docs/docker-image.md#updating"
    )
    self_hosting_update_docs_url: str = Field(
        default="https://github.com/manasijatech/ananta-market-stack/blob/main/docs/self-hosting.md#updating-safely"
    )
