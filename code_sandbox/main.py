"""Trusted code-mode runner.

The backend connects over a Unix socket, sends guest source plus the generated
API module, and services RPC frames. This process has no credentials. The guest
Python is a subprocess with a cleared environment and, when the runner is root,
a nobody uid so it cannot open the socket.
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import importlib.util
import json
import os
import pwd
import secrets
import shutil
import signal
import sys
import tempfile
from pathlib import Path

_MESSAGE_LIMIT = 2_000_000
_MAX_CODE_BYTES = 262144
_MAX_API_BYTES = 1048576
_AS_BYTES = 512 * 1024 * 1024
_FSIZE_BYTES = 1024 * 1024
EXEC_SLOTS = asyncio.Semaphore(2)


def _load_bridge():
    name = "ananta_code_sandbox_bridge"
    cached = sys.modules.get(name)
    if cached is not None:
        return cached
    path = Path(__file__).with_name("bridge.py")
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_bridge = _load_bridge()
collect_bridge = _bridge.collect_bridge


def bootstrap(code, library, rpc_prefix="@@ANANTA_RPC "):
    """Same guest entry as backend.app.agent_harness.code_mode.bootstrap.

    User code is registered with linecache so a traceback shows "<code_run>"
    frames and the exception line, not this script's string literals.
    """
    return ("import linecache, sys, traceback, types\n"
            "_p = types.ModuleType('ananta'); _p.__path__ = []\n"
            "_a = types.ModuleType('ananta.api'); _p.api = _a\n"
            "sys.modules['ananta'] = _p; sys.modules['ananta.api'] = _a\n"
            f"_a.__dict__['_RPC_PREFIX'] = {rpc_prefix!r}\n"
            f"_api_source = {library!r}\n"
            "exec(compile(_api_source, 'ananta/api.py', 'exec'), _a.__dict__)\n"
            f"_code = {code!r}\n"
            "linecache.cache['<code_run>'] = (len(_code), None, _code.splitlines(True), '<code_run>')\n"
            "try:\n"
            "    exec(compile(_code, '<code_run>', 'exec'), {'__name__': '__main__'})\n"
            "except SystemExit:\n"
            "    raise\n"
            "except BaseException as _exc:\n"
            "    _frames = [f for f in traceback.extract_tb(_exc.__traceback__) if f.filename == '<code_run>']\n"
            "    sys.stderr.write('Traceback (your code):\\n' + ''.join(traceback.format_list(_frames))\n"
            "                     + ''.join(traceback.format_exception_only(type(_exc), _exc)))\n"
            "    sys.exit(1)\n")


def guest_program(code: str, api_source: str, *, cpu_seconds: int, limit_nproc: bool, rpc_prefix: str = "@@ANANTA_RPC ") -> str:
    nproc = "_cap(_resource.RLIMIT_NPROC, 32)\n" if limit_nproc else ""
    header = (
        "import resource as _resource\n"
        "def _cap(resource_id, value):\n"
        "    try:\n"
        "        _soft, hard = _resource.getrlimit(resource_id)\n"
        "        target = value\n"
        "        if hard != _resource.RLIM_INFINITY:\n"
        "            target = min(target, hard)\n"
        "        ceiling = target if hard == _resource.RLIM_INFINITY else hard\n"
        "        _resource.setrlimit(resource_id, (target, ceiling))\n"
        "    except (ValueError, OSError):\n"
        "        pass\n"
        f"_cap(_resource.RLIMIT_AS, {_AS_BYTES})\n"
        # Keep a few CPU seconds so CPython can start; the wall-clock timeout still kills sleeps.
        f"_cap(_resource.RLIMIT_CPU, {max(10, int(cpu_seconds))})\n"
        f"{nproc}"
        f"_cap(_resource.RLIMIT_FSIZE, {_FSIZE_BYTES})\n"
        "_cap(_resource.RLIMIT_NOFILE, 32)\n"
    )
    return header + bootstrap(code, api_source, rpc_prefix)


def guest_identity(allow_same_uid: bool):
    """Return (uid, gid) to drop to, or None when the guest stays the runner uid."""
    if allow_same_uid:
        return None
    try:
        account = pwd.getpwnam("nobody")
    except KeyError as exc:
        raise RuntimeError("cannot drop privileges (nobody user is missing)") from exc
    if os.geteuid() != 0 and os.geteuid() != account.pw_uid:
        raise RuntimeError("cannot drop privileges (runner is not root)")
    if os.geteuid() == account.pw_uid:
        return None
    return account.pw_uid, account.pw_gid


def guest_env(work_dir: str) -> dict[str, str]:
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": work_dir,
        "TMPDIR": work_dir,
        "LANG": "C.UTF-8",
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "PYTHONSAFEPATH": "1",
    }


class _Pipes:
    def __init__(self, proc: asyncio.subprocess.Process):
        self.proc = proc

    def stdin(self):
        return self

    async def send_input(self, data: bytes) -> None:
        if self.proc.stdin is None:
            return
        self.proc.stdin.write(data)
        await self.proc.stdin.drain()

    async def close(self) -> None:
        if self.proc.stdin is not None and not self.proc.stdin.is_closing():
            self.proc.stdin.close()
            try:
                await self.proc.stdin.wait_closed()
            except Exception:
                pass

    async def stdout(self):
        if self.proc.stdout is None:
            return
        while True:
            chunk = await self.proc.stdout.read(8192)
            if not chunk:
                break
            yield chunk

    async def stderr(self):
        if self.proc.stderr is None:
            return
        while True:
            chunk = await self.proc.stderr.read(8192)
            if not chunk:
                break
            yield chunk

    async def wait(self):
        from types import SimpleNamespace
        return SimpleNamespace(exit_code=await self.proc.wait())


def kill_process_group(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


async def execute(code: str, api_source: str, timeout_seconds: int, rpc, *, allow_same_uid: bool) -> dict:
    try:
        identity = guest_identity(allow_same_uid)
    except RuntimeError as exc:
        return {"stdout": "", "stderr": str(exc), "exit_code": 1, "truncated": False}
    work = Path(tempfile.mkdtemp(prefix="ananta-guest-"))
    proc: asyncio.subprocess.Process | None = None
    # Per-exec nonce: data the script prints (web pages, filings) cannot forge frames.
    rpc_prefix = f"@@ANANTA_RPC:{secrets.token_hex(16)} "
    try:
        script = guest_program(
            code,
            api_source,
            cpu_seconds=timeout_seconds,
            limit_nproc=identity is not None,
            rpc_prefix=rpc_prefix,
        )
        script_path = work / "main.py"
        script_path.write_text(script, encoding="utf-8")
        kwargs = {}
        if identity is not None:
            kwargs["user"] = identity[0]
            kwargs["group"] = identity[1]
            kwargs["extra_groups"] = []
        # Production drops every capability except SETUID/SETGID/CHOWN/KILL.
        # chmod after chown fails without CAP_FOWNER, and a mode-700 directory
        # owned by nobody cannot be traversed by the runner without
        # CAP_DAC_OVERRIDE, so the guest would never start. nobody still owns
        # the directory and can write in it. The socket directory stays mode 700.
        try:
            if identity is not None:
                os.chmod(work, 0o751)
                os.chmod(script_path, 0o644)
                os.chown(work, identity[0], identity[1])
                os.chown(script_path, identity[0], identity[1])
            else:
                os.chmod(work, 0o700)
                os.chmod(script_path, 0o600)
        except OSError:
            os.chmod(work, 0o755)
            os.chmod(script_path, 0o644)
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-I",
            "-B",
            "-u",
            str(script_path),
            cwd=str(work),
            env=guest_env(str(work)),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
            **kwargs,
        )
        try:
            stdout, stderr, exit_code, truncated = await asyncio.wait_for(
                collect_bridge(_Pipes(proc), rpc, max_output_bytes=65536, prefix=rpc_prefix.encode()),
                timeout=timeout_seconds + 1,
            )
        except asyncio.TimeoutError:
            kill_process_group(proc)
            return {"stdout": "", "stderr": "execution timed out", "exit_code": 124, "truncated": False}
        except ValueError as exc:
            kill_process_group(proc)
            return {"stdout": "", "stderr": str(exc), "exit_code": 1, "truncated": False}
        return {"stdout": stdout, "stderr": stderr, "exit_code": int(exit_code), "truncated": bool(truncated)}
    finally:
        if proc is not None and proc.returncode is None:
            kill_process_group(proc)
            try:
                await asyncio.wait_for(proc.wait(), timeout=2)
            except Exception:
                pass
        shutil.rmtree(work, ignore_errors=True)


def tokens_match(provided: str, expected: str) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())


async def _send(writer: asyncio.StreamWriter, payload: dict) -> None:
    writer.write((json.dumps(payload, allow_nan=False) + "\n").encode())
    await writer.drain()


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *, token: str, allow_same_uid: bool) -> None:
    try:
        line = await asyncio.wait_for(reader.readline(), timeout=30)
        if not line:
            return
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            await _send(writer, {"type": "error", "error": "invalid JSON", "exit_code": 1})
            return
        if not isinstance(message, dict) or not tokens_match(str(message.get("token") or ""), token):
            await _send(writer, {"type": "error", "error": "unauthorized", "exit_code": 1})
            return
        kind = message.get("type")
        if kind == "ping":
            await _send(writer, {"type": "pong"})
            return
        if kind != "exec":
            await _send(writer, {"type": "error", "error": "expected exec", "exit_code": 1})
            return
        code = message.get("code")
        api_source = message.get("api_source")
        if not isinstance(code, str) or not isinstance(api_source, str):
            await _send(writer, {"type": "error", "error": "code and api_source are required", "exit_code": 1})
            return
        if len(code.encode()) > _MAX_CODE_BYTES or len(api_source.encode()) > _MAX_API_BYTES:
            await _send(writer, {"type": "error", "error": "code or api module is too large", "exit_code": 1})
            return
        try:
            timeout = max(1, min(120, int(message.get("timeout_seconds") or 60)))
        except (TypeError, ValueError):
            timeout = 60
        exec_id = str(message.get("exec_id") or "")
        loop = asyncio.get_running_loop()
        pending: dict[int, asyncio.Future] = {}

        async def reader_loop() -> None:
            while True:
                raw = await reader.readline()
                if not raw:
                    for fut in pending.values():
                        if not fut.done():
                            fut.set_exception(ConnectionError("backend closed"))
                    return
                try:
                    incoming = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(incoming, dict) or incoming.get("type") != "rpc_reply":
                    continue
                reply = incoming.get("reply")
                if not isinstance(reply, dict):
                    continue
                fut = pending.get(reply.get("id"))
                if fut is not None and not fut.done():
                    fut.set_result(reply)

        reader_task = asyncio.create_task(reader_loop())

        async def rpc(frame):
            fut = loop.create_future()
            pending[frame.get("id")] = fut
            try:
                await _send(writer, {"type": "rpc", "exec_id": exec_id, "frame": frame})
                return await asyncio.wait_for(fut, timeout=timeout + 5)
            finally:
                pending.pop(frame.get("id"), None)

        try:
            async with EXEC_SLOTS:
                result = await execute(code, api_source, timeout, rpc, allow_same_uid=allow_same_uid)
            await _send(writer, {"type": "result", "exec_id": exec_id, **result})
        except Exception as exc:
            try:
                await _send(writer, {"type": "error", "exec_id": exec_id, "error": str(exc)[:4000], "exit_code": 1})
            except Exception:
                pass
        finally:
            reader_task.cancel()
            await asyncio.gather(reader_task, return_exceptions=True)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def serve(socket_path: str, token: str, *, allow_same_uid: bool = False) -> asyncio.Server:
    path = Path(socket_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    if path.exists():
        path.unlink()
    previous = os.umask(0o077)

    def client(reader, writer):
        return handle(reader, writer, token=token, allow_same_uid=allow_same_uid)

    try:
        server = await asyncio.start_unix_server(client, path=str(path), limit=_MESSAGE_LIMIT)
    finally:
        os.umask(previous)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return server


def _read_token(path: str) -> str:
    token = Path(path).read_text(encoding="utf-8").strip()
    if not token:
        raise SystemExit(f"token file is empty: {path}")
    return token


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Ananta code-mode runner")
    parser.add_argument("--socket", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument(
        "--allow-same-uid",
        action="store_true",
        help="Test-only. Do not use in the container; the guest would share the runner uid.",
    )
    args = parser.parse_args(argv)
    token = _read_token(args.token_file)

    async def run() -> None:
        server = await serve(args.socket, token, allow_same_uid=args.allow_same_uid)
        await server.serve_forever()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
