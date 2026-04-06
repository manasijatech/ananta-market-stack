from datetime import datetime

from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    display_name: str | None = Field(None, max_length=256)


class UserOut(BaseModel):
    id: str
    display_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
