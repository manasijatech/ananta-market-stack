from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services import deployment_updates
from db.models import SystemDeploymentState
from db.session import Base


def _mock_token_response() -> MagicMock:
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = {"token": "anon-token"}
    return response


def _mock_manifest_response(digest: str) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.raise_for_status = MagicMock()
    response.headers = {"docker-content-digest": digest}
    return response


def test_run_deployment_update_check_marks_update_available_when_latest_differs():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    original_session_local = deployment_updates.SessionLocal
    deployment_updates.SessionLocal = session_factory
    deployment_updates._last_check_monotonic = None

    build_info = {"sha": "abc1234567890", "version": "0.1.0"}
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=False)
    client.get.return_value = _mock_token_response()
    client.head.side_effect = [
        _mock_manifest_response("sha256:latest-digest"),
        _mock_manifest_response("sha256:running-digest"),
    ]

    try:
        with (
            patch.object(deployment_updates, "_read_build_info", return_value=build_info),
            patch.object(deployment_updates, "httpx") as httpx_module,
        ):
            httpx_module.Client.return_value = client
            deployment_updates.run_deployment_update_check_once(force=True)

        db = session_factory()
        state = db.get(SystemDeploymentState, deployment_updates.DEFAULT_STATE_ID)
        assert state is not None
        assert state.update_available is True
        assert state.running_digest == "sha256:running-digest"
        assert state.latest_digest == "sha256:latest-digest"
        assert state.running_version == "0.1.0"
        assert state.last_check_error is None
        db.close()
    finally:
        deployment_updates.SessionLocal = original_session_local


def test_run_deployment_update_check_skips_local_builds():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    original_session_local = deployment_updates.SessionLocal
    deployment_updates.SessionLocal = session_factory
    deployment_updates._last_check_monotonic = None

    try:
        with (
            patch.object(deployment_updates, "_read_build_info", return_value={"sha": "local"}),
            patch.object(deployment_updates, "httpx") as httpx_module,
        ):
            deployment_updates.run_deployment_update_check_once(force=True)
            httpx_module.Client.assert_not_called()

        db = session_factory()
        assert db.get(SystemDeploymentState, deployment_updates.DEFAULT_STATE_ID) is None
        db.close()
    finally:
        deployment_updates.SessionLocal = original_session_local


def test_run_deployment_update_check_preserves_flag_on_registry_error():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    original_session_local = deployment_updates.SessionLocal
    deployment_updates.SessionLocal = session_factory
    deployment_updates._last_check_monotonic = None

    build_info = {"sha": "abc1234567890", "digest": "sha256:running-digest"}

    try:
        with (
            patch.object(deployment_updates, "_read_build_info", return_value=build_info),
            patch.object(
                deployment_updates.httpx,
                "Client",
                side_effect=httpx.ConnectError("network down"),
            ),
        ):
            deployment_updates.run_deployment_update_check_once(force=True)

        db = session_factory()
        state = db.get(SystemDeploymentState, deployment_updates.DEFAULT_STATE_ID)
        assert state is not None
        assert state.update_available is False
        assert state.last_check_error == "network down"
        db.close()
    finally:
        deployment_updates.SessionLocal = original_session_local


def test_get_deployment_update_status_returns_docs_links():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    original_session_local = deployment_updates.SessionLocal
    deployment_updates.SessionLocal = session_factory

    db = session_factory()
    db.add(
        SystemDeploymentState(
            id=deployment_updates.DEFAULT_STATE_ID,
            running_version="0.1.0",
            running_sha="abc1234",
            running_digest="sha256:running-digest",
            latest_digest="sha256:latest-digest",
            update_available=True,
        )
    )
    db.commit()
    db.close()

    try:
        with patch.object(
            deployment_updates,
            "_read_build_info",
            return_value={"sha": "abc1234", "version": "0.1.0"},
        ):
            status = deployment_updates.get_deployment_update_status()

        assert status.update_available is True
        assert status.docker_image_update_docs_url.endswith("docs/docker-image.md#updating")
        assert status.self_hosting_update_docs_url.endswith("docs/self-hosting.md#updating-safely")
    finally:
        deployment_updates.SessionLocal = original_session_local
