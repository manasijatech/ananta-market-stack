"""Async client for the optional code-mode Unix socket runner.

The backend holds credentials and executes tools. The runner only receives
guest source, the generated API module, and numeric limits.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from uuid import uuid4

from app.config import get_settings

# 8 results x 1 MiB of JSON (escaping is inside that cap) plus the rpc_reply
# wrapper. Keep this equal to code_sandbox/main.py MESSAGE_LIMIT.
_MAX_BATCH_RESULTS = 8
_MAX_RESULT_BYTES = 1_048_576
_MESSAGE_LIMIT = _MAX_BATCH_RESULTS * _MAX_RESULT_BYTES + 65_536
# Covers the guest wall clock plus bridge reads, writes, and a hung tool call.
BRIDGE_DEADLINE_MARGIN = 20
_SIZE_ERROR = "API batch exceeds the transport size limit; narrow the query"


def _token() -> str:
    path = get_settings().code_sandbox_token_file
    if not path or not os.path.isfile(path):
        raise ConnectionError("code sandbox token file is missing")
    token = Path(path).read_text(encoding="utf-8").strip()
    if not token:
        raise ConnectionError("code sandbox token is empty")
    return token


async def _send(writer: asyncio.StreamWriter, payload: dict) -> None:
    writer.write((json.dumps(payload, allow_nan=False) + "\n").encode())
    await writer.drain()


async def _connect(timeout: float) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    socket_path = get_settings().code_sandbox_socket
    if not socket_path or not os.path.exists(socket_path):
        raise ConnectionError("code sandbox socket is missing")
    return await asyncio.wait_for(
        asyncio.open_unix_connection(socket_path, limit=_MESSAGE_LIMIT),
        timeout=timeout,
    )


async def sandbox_status() -> tuple[bool, str]:
    """Return whether the runner accepts an authenticated ping."""
    socket_path = get_settings().code_sandbox_socket
    if not socket_path or not os.path.exists(socket_path):
        return False, "socket_missing"
    try:
        token = _token()
    except ConnectionError as exc:
        reason = str(exc)
        if "missing" in reason:
            return False, "token_missing"
        return False, "token_empty"
    writer: asyncio.StreamWriter | None = None
    try:
        reader, writer = await _connect(1.5)
        await _send(writer, {"type": "ping", "token": token})
        line = await asyncio.wait_for(reader.readline(), timeout=1.5)
        message = json.loads(line.decode() if line else "{}")
        if message.get("type") != "pong":
            return False, "unexpected_ping_reply"
        return True, ""
    except Exception:
        return False, "socket_unreachable"
    finally:
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass


def _rpc_reply_payload(exec_id: str, reply) -> dict:
    """Fit one batch on the wire, or replace it with an explicit size error.

    The guest reads that error as ApiError instead of waiting out the timeout.
    """
    payload = {"type": "rpc_reply", "exec_id": exec_id, "reply": reply}
    try:
        encoded = json.dumps(payload, allow_nan=False).encode()
    except (TypeError, ValueError):
        return {
            "type": "rpc_reply",
            "exec_id": exec_id,
            "reply": {
                "id": reply.get("id") if isinstance(reply, dict) else None,
                "results": [{"ok": False, "error": "API result is not JSON"}],
            },
        }
    if len(encoded) + 1 <= _MESSAGE_LIMIT:
        return payload
    results = reply.get("results") if isinstance(reply, dict) else None
    count = len(results) if isinstance(results, list) and results else 1
    return {
        "type": "rpc_reply",
        "exec_id": exec_id,
        "reply": {
            "id": reply.get("id") if isinstance(reply, dict) else None,
            "results": [{"ok": False, "error": _SIZE_ERROR} for _ in range(count)],
        },
    }


def _remaining(deadline: float) -> float:
    left = deadline - time.monotonic()
    if left <= 0:
        raise TimeoutError("code sandbox deadline exceeded")
    return left


async def run_bridge(*, user_id, session_key, code, api_source, timeout_seconds, rpc):
    """Run guest code. user_id and session_key stay in the backend and are not sent.

    The whole bridge, including an inner tool dispatch, shares one monotonic
    deadline. When it expires the outstanding dispatch is cancelled.
    """
    del user_id, session_key
    token = _token()
    timeout = max(1, min(120, int(timeout_seconds)))
    deadline = time.monotonic() + timeout + BRIDGE_DEADLINE_MARGIN
    reader, writer = await _connect(min(5, _remaining(deadline)))
    try:
        exec_id = uuid4().hex
        await asyncio.wait_for(_send(writer, {
            "type": "exec",
            "token": token,
            "exec_id": exec_id,
            "code": code,
            "api_source": api_source if isinstance(api_source, str) else "",
            "timeout_seconds": timeout,
        }), timeout=_remaining(deadline))
        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=_remaining(deadline))
            if not line:
                raise ConnectionError("code sandbox closed the socket")
            message = json.loads(line)
            kind = message.get("type")
            if kind == "rpc":
                if message.get("exec_id") not in {None, exec_id}:
                    raise ConnectionError("code sandbox rpc exec_id mismatch")
                reply = await asyncio.wait_for(rpc(message.get("frame") or {}), timeout=_remaining(deadline))
                await asyncio.wait_for(
                    _send(writer, _rpc_reply_payload(exec_id, reply)),
                    timeout=_remaining(deadline),
                )
            elif kind == "result":
                return {
                    "stdout": message.get("stdout") or "",
                    "stderr": message.get("stderr") or "",
                    "exit_code": int(message.get("exit_code") or 0),
                    "truncated": bool(message.get("truncated")),
                }
            elif kind == "error":
                raise RuntimeError(str(message.get("error") or "code sandbox error")[:4000])
            else:
                raise RuntimeError("unexpected code sandbox message")
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
