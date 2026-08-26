from app.config import get_settings


def adaptive_workspace_enabled() -> bool:
    return bool(get_settings().enable_adaptive_workspace)
