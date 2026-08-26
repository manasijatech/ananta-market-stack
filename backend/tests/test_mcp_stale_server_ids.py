from app.services.mcp_config import resolve_mcp_server_ids


class _Row:
    def __init__(self, id: str, is_enabled: bool = True, url: str = "https://mcp.example", use_by_default: bool = True):
        self.id = id
        self.is_enabled = is_enabled
        self.url = url
        self.use_by_default = use_by_default


def test_resolve_mcp_server_ids_falls_back_from_stale_selection(monkeypatch):
    current = _Row("current-server")
    monkeypatch.setattr("app.services.mcp_config.rbac.workspace_config_owner_user_id", lambda db, user_id: "owner")
    monkeypatch.setattr("app.services.mcp_config._mcp_server_rows", lambda db, owner: [current])

    matched, dropped = resolve_mcp_server_ids(object(), "user", ["stale-server"])
    assert matched == ["current-server"]
    assert dropped == ["stale-server"]


def test_resolve_mcp_server_ids_keeps_valid_selection(monkeypatch):
    current = _Row("current-server")
    extra = _Row("other-server", use_by_default=False)
    monkeypatch.setattr("app.services.mcp_config.rbac.workspace_config_owner_user_id", lambda db, user_id: "owner")
    monkeypatch.setattr("app.services.mcp_config._mcp_server_rows", lambda db, owner: [current, extra])

    matched, dropped = resolve_mcp_server_ids(object(), "user", ["other-server"])
    assert matched == ["other-server"]
    assert dropped == []
