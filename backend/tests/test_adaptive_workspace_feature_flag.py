from fastapi.testclient import TestClient

from app.main import app
from app.services.broker_chat_runner import _adaptive_workspace_enabled


DISABLED_DETAIL = "Adaptive Workspace is not enabled on this instance."


def _set_flag(monkeypatch, enabled: bool) -> None:
    monkeypatch.setattr(
        "app.services.feature_flags.adaptive_workspace_enabled",
        lambda: enabled,
    )


def test_features_endpoint_false_when_flag_off(monkeypatch):
    _set_flag(monkeypatch, False)
    with TestClient(app) as client:
        response = client.get("/api/v1/features")
    assert response.status_code == 200
    assert response.json() == {"adaptive_workspace": False}


def test_adaptive_workspace_routes_404_when_flag_off(monkeypatch):
    _set_flag(monkeypatch, False)
    with TestClient(app) as client:
        response = client.get("/api/v1/adaptive-workspace/templates")
    assert response.status_code == 404
    assert response.json()["detail"] == DISABLED_DETAIL


def test_features_and_routes_when_flag_on(monkeypatch):
    _set_flag(monkeypatch, True)
    with TestClient(app) as client:
        features = client.get("/api/v1/features")
        gated = client.get("/api/v1/adaptive-workspace/templates")
    assert features.status_code == 200
    assert features.json() == {"adaptive_workspace": True}
    assert gated.status_code != 404
    assert gated.status_code in {401, 403}


def test_runner_helper_false_when_flag_off_even_with_metadata(monkeypatch):
    _set_flag(monkeypatch, False)
    assert _adaptive_workspace_enabled({"adaptive_workspace": True}) is False
    assert _adaptive_workspace_enabled({}) is False


def test_runner_helper_requires_flag_and_metadata(monkeypatch):
    _set_flag(monkeypatch, True)
    assert _adaptive_workspace_enabled({"adaptive_workspace": True}) is True
    assert _adaptive_workspace_enabled({}) is False
    assert _adaptive_workspace_enabled({"adaptive_workspace": False}) is False
