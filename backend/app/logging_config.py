from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

from app.config import get_settings

_FILE_HANDLER_NAME = "ananta-market-stack-debug-file"


def _level_from_name(value: str | None, *, default: int) -> int:
    if not value:
        return default
    candidate = getattr(logging, value.strip().upper(), None)
    return candidate if isinstance(candidate, int) else default


def configure_logging() -> Path | None:
    settings = get_settings()
    debug_enabled = bool(settings.debug)
    file_enabled = settings.log_to_file if settings.log_to_file is not None else debug_enabled
    root = logging.getLogger()
    level = _level_from_name(settings.log_level, default=logging.DEBUG if debug_enabled else logging.INFO)
    root.setLevel(min(root.level, level) if root.level else level)

    for logger_name in ("app", "broker", "db", "common"):
        logging.getLogger(logger_name).setLevel(level)

    if not file_enabled:
        return None

    log_path = Path(settings.log_file_path).expanduser()
    log_path.parent.mkdir(parents=True, exist_ok=True)

    existing = next(
        (handler for handler in root.handlers if getattr(handler, "name", "") == _FILE_HANDLER_NAME),
        None,
    )
    if existing is None:
        handler = logging.handlers.RotatingFileHandler(
            log_path,
            maxBytes=max(settings.log_file_max_bytes, 1024 * 1024),
            backupCount=max(settings.log_file_backup_count, 1),
            encoding="utf-8",
        )
        handler.name = _FILE_HANDLER_NAME
        handler.setLevel(level)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s [%(name)s] [%(threadName)s] %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        root.addHandler(handler)
    else:
        existing.setLevel(level)

    logging.captureWarnings(True)
    logging.getLogger(__name__).info(
        "debug file logging enabled at %s max_bytes=%s backups=%s level=%s",
        log_path,
        settings.log_file_max_bytes,
        settings.log_file_backup_count,
        logging.getLevelName(level),
    )
    return log_path
