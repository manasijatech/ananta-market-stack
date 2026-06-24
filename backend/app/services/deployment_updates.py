from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.deployment import DeploymentUpdateStatusOut
from common.datetime_compat import UTC
from db.models import SystemDeploymentState
from db.session import SessionLocal

logger = logging.getLogger(__name__)

DEFAULT_STATE_ID = "default"
BUILD_INFO_PATH = Path("/app/BUILD_INFO.json")
DOCKER_IMAGE_UPDATE_DOCS_URL = (
    "https://github.com/manasijatech/ananta-market-stack/blob/main/docs/docker-image.md#updating"
)
SELF_HOSTING_UPDATE_DOCS_URL = (
    "https://github.com/manasijatech/ananta-market-stack/blob/main/docs/self-hosting.md#updating-safely"
)

_last_check_monotonic: float | None = None


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _settings():
    return get_settings()


def _read_build_info() -> dict[str, str]:
    info: dict[str, str] = {}
    settings = _settings()
    if settings.market_stack_build_sha:
        info["sha"] = settings.market_stack_build_sha.strip()
    if settings.market_stack_build_version:
        info["version"] = settings.market_stack_build_version.strip()
    if settings.market_stack_image_digest:
        info["digest"] = settings.market_stack_image_digest.strip()

    if BUILD_INFO_PATH.is_file():
        try:
            payload = json.loads(BUILD_INFO_PATH.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                for key in ("sha", "version", "digest"):
                    value = payload.get(key)
                    if isinstance(value, str) and value.strip():
                        info.setdefault(key, value.strip())
        except (OSError, json.JSONDecodeError):
            logger.debug("failed to read build info from %s", BUILD_INFO_PATH, exc_info=True)
    return info


def _repository_parts(repository: str) -> tuple[str, str]:
    repo = repository.strip()
    if repo.startswith("ghcr.io/"):
        repo = repo[len("ghcr.io/") :]
    parts = repo.split("/", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(f"invalid deployment image repository: {repository!r}")
    return parts[0].lower(), parts[1].lower()


def _registry_host(repository: str) -> str:
    repo = repository.strip()
    if "/" in repo and "." in repo.split("/")[0]:
        return repo.split("/", 1)[0]
    return "ghcr.io"


def _fetch_anonymous_token(
    client: httpx.Client,
    *,
    registry: str,
    owner: str,
    name: str,
) -> str:
    scope = f"repository:{owner}/{name}:pull"
    response = client.get(f"https://{registry}/token", params={"scope": scope})
    response.raise_for_status()
    payload = response.json()
    token = payload.get("token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("registry token response missing token")
    return token


def _fetch_manifest_digest(
    client: httpx.Client,
    *,
    registry: str,
    owner: str,
    name: str,
    tag: str,
    token: str | None = None,
) -> str:
    headers = {
        "Accept": ", ".join(
            [
                "application/vnd.oci.image.index.v1+json",
                "application/vnd.docker.distribution.manifest.v2+json",
                "application/vnd.oci.image.manifest.v1+json",
            ]
        ),
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = f"https://{registry}/v2/{owner}/{name}/manifests/{tag}"
    response = client.head(url, headers=headers, follow_redirects=True)
    if response.status_code == 401 and token is None:
        token = _fetch_anonymous_token(client, registry=registry, owner=owner, name=name)
        headers["Authorization"] = f"Bearer {token}"
        response = client.head(url, headers=headers, follow_redirects=True)
    response.raise_for_status()
    digest = response.headers.get("docker-content-digest") or response.headers.get(
        "Docker-Content-Digest"
    )
    if not digest:
        raise RuntimeError(f"manifest response for {tag} missing docker-content-digest header")
    return digest.strip()


def _resolve_running_digest(client: httpx.Client, build_info: dict[str, str]) -> str | None:
    if digest := build_info.get("digest"):
        return digest

    settings = _settings()
    registry = _registry_host(settings.deployment_image_repository)
    owner, name = _repository_parts(settings.deployment_image_repository)

    sha = build_info.get("sha", "")
    if sha and sha != "local":
        short_sha = sha[:7] if len(sha) >= 7 else sha
        try:
            token = _fetch_anonymous_token(client, registry=registry, owner=owner, name=name)
            return _fetch_manifest_digest(
                client,
                registry=registry,
                owner=owner,
                name=name,
                tag=f"sha-{short_sha}",
                token=token,
            )
        except Exception:
            logger.debug("could not resolve running digest from sha-%s", short_sha, exc_info=True)
    return None


def _has_publishable_build_metadata(build_info: dict[str, str]) -> bool:
    if build_info.get("digest"):
        return True
    sha = build_info.get("sha")
    return bool(sha and sha != "local")


def _get_or_create_state(db: Session) -> SystemDeploymentState:
    state = db.get(SystemDeploymentState, DEFAULT_STATE_ID)
    if state is None:
        state = SystemDeploymentState(id=DEFAULT_STATE_ID)
        db.add(state)
    return state


def run_deployment_update_check_once(*, force: bool = False) -> None:
    global _last_check_monotonic
    settings = _settings()
    if not settings.deployment_update_checks_enabled:
        return

    build_info = _read_build_info()
    if not _has_publishable_build_metadata(build_info):
        return

    interval = max(settings.deployment_update_check_interval_seconds, 300)
    now = time.monotonic()
    if not force:
        if _last_check_monotonic is not None and now - _last_check_monotonic < interval:
            return

    _last_check_monotonic = now
    checked_at = _utc_now()
    db = SessionLocal()
    try:
        state = _get_or_create_state(db)
        state.running_sha = build_info.get("sha")
        state.running_version = build_info.get("version") or None
        state.updated_at = checked_at

        registry = _registry_host(settings.deployment_image_repository)
        owner, name = _repository_parts(settings.deployment_image_repository)
        tag = settings.deployment_image_tag.strip() or "latest"

        try:
            with httpx.Client(timeout=settings.deployment_update_check_timeout_seconds) as client:
                token = _fetch_anonymous_token(client, registry=registry, owner=owner, name=name)
                latest_digest = _fetch_manifest_digest(
                    client,
                    registry=registry,
                    owner=owner,
                    name=name,
                    tag=tag,
                    token=token,
                )
                running_digest = _resolve_running_digest(client, build_info)
                if running_digest:
                    state.running_digest = running_digest
                state.latest_digest = latest_digest
                state.last_checked_at = checked_at
                state.last_check_error = None
                if state.running_digest and latest_digest:
                    state.update_available = state.running_digest != latest_digest
                else:
                    state.update_available = False
        except Exception as exc:
            state.last_checked_at = checked_at
            state.last_check_error = str(exc)[:500]
            logger.warning("deployment update check failed: %s", exc)
        db.commit()
    finally:
        db.close()


def get_deployment_update_status() -> DeploymentUpdateStatusOut:
    settings = _settings()
    build_info = _read_build_info()
    db = SessionLocal()
    try:
        state = db.get(SystemDeploymentState, DEFAULT_STATE_ID)
        if state is None:
            return DeploymentUpdateStatusOut(
                checks_enabled=settings.deployment_update_checks_enabled
                and _has_publishable_build_metadata(build_info),
                update_available=False,
                running_version=build_info.get("version") or None,
                running_sha=build_info.get("sha") or None,
                running_digest=build_info.get("digest") or None,
                image_repository=settings.deployment_image_repository,
                image_tag=settings.deployment_image_tag,
            )

        return DeploymentUpdateStatusOut(
            checks_enabled=settings.deployment_update_checks_enabled
            and _has_publishable_build_metadata(build_info),
            update_available=bool(state.update_available),
            running_version=state.running_version or build_info.get("version") or None,
            running_sha=state.running_sha or build_info.get("sha") or None,
            running_digest=state.running_digest or build_info.get("digest") or None,
            latest_digest=state.latest_digest,
            image_repository=settings.deployment_image_repository,
            image_tag=settings.deployment_image_tag,
            last_checked_at=state.last_checked_at,
            last_check_error=state.last_check_error,
        )
    finally:
        db.close()
