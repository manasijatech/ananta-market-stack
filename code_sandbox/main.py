"""Trusted code-mode runner.

The backend connects over a Unix socket, sends guest source plus the generated
API module, and services RPC frames. This process has no credentials. Each
exec slot runs as its own unprivileged uid (61001..6100N). The guest program
is delivered on a pipe, not a file another uid can read. Work directories are
mode 0700 under a root-owned, non-listable parent.
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import importlib.util
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# 8 results x 1 MiB of JSON. Per-result escaping is inside that 1 MiB cap
# (the host measures json.dumps(value)). The extra 64 KiB is the rpc_reply
# wrapper. Keep this equal to code_sandbox_client._MESSAGE_LIMIT.
SLOT_COUNT = 2
GUEST_UID_BASE = 61001
MESSAGE_LIMIT = 8 * 1_048_576 + 65_536
OUTER_MARGIN_SECONDS = 8
_MAX_CODE_BYTES = 262144
_MAX_API_BYTES = 1048576
_AS_BYTES = 512 * 1024 * 1024
_FSIZE_BYTES = 1024 * 1024
_BOOT_LOADER = (
    "import os\n"
    "os.chdir(os.environ['HOME'])\n"
    "_fd = int(os.environ.pop('ANANTA_BOOTSTRAP_FD'))\n"
    "_fh = os.fdopen(_fd)\n"
    "_src = _fh.read()\n"
    "_fh.close()\n"
    "exec(_src)\n"
)
_CLEANUP = (
    "import os, shutil, sys\n"
    "root = sys.argv[1]\n"
    "for name in os.listdir(root):\n"
    "    path = os.path.join(root, name)\n"
    "    if os.path.islink(path):\n"
    "        os.remove(path)\n"
    "    elif os.path.isdir(path):\n"
    "        shutil.rmtree(path)\n"
    "    else:\n"
    "        os.remove(path)\n"
)

_slots: asyncio.Queue | None = None
_guest_root: Path | None = None


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


class _Slot:
    __slots__ = ("index", "uid", "gid")

    def __init__(self, index: int):
        self.index = index
        self.uid = GUEST_UID_BASE + index
        self.gid = GUEST_UID_BASE + index


class _ExecState:
    def __init__(self):
        self.slot: _Slot | None = None
        self.proc: asyncio.subprocess.Process | None = None
        self.guest_uid: int | None = None


def _slot_queue() -> asyncio.Queue:
    global _slots
    if _slots is None:
        _slots = asyncio.Queue()
        for index in range(SLOT_COUNT):
            _slots.put_nowait(_Slot(index))
    return _slots


def guest_identity(allow_same_uid: bool, slot: _Slot | None = None):
    """Return (uid, gid) for this slot, or None when the guest stays the runner uid.

    Production uids are 61001..6100N, one per exec slot, created in the image.
    """
    if allow_same_uid:
        return None
    if os.geteuid() != 0:
        raise RuntimeError("cannot drop privileges (runner is not root)")
    chosen = slot if slot is not None else _Slot(0)
    return chosen.uid, chosen.gid


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


def guest_root_path() -> Path:
    return Path(os.environ.get("ANANTA_GUEST_ROOT", "/var/ananta-guests"))


def _pids_for_uid(uid: int, skip: int) -> list[int]:
    found = []
    try:
        entries = os.listdir("/proc")
    except OSError:
        return found
    for entry in entries:
        if not entry.isdigit():
            continue
        pid = int(entry)
        if pid == skip:
            continue
        try:
            with open(f"/proc/{pid}/status", "r", encoding="utf-8") as handle:
                for line in handle:
                    if line.startswith("Uid:"):
                        parts = line.split()
                        if int(parts[1]) == uid or int(parts[2]) == uid:
                            found.append(pid)
                        break
        except (OSError, IndexError, ValueError):
            continue
    return found


def kill_processes_for_uid(uid: int | None) -> None:
    """SIGKILL every process with this uid. Never signals the runner's own uid."""
    if uid is None or uid <= 0 or uid == os.geteuid():
        return
    me = os.getpid()
    for _ in range(4):
        pids = _pids_for_uid(uid, me)
        if not pids:
            return
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass


def kill_process_group(proc: asyncio.subprocess.Process | None) -> None:
    """Kill the guest session, including after its leader has already exited.

    A detached child stays in the session when the leader's returncode is set.
    Skipping the signal in that case is how survivors used to escape.
    """
    if proc is None or proc.pid is None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass


def _abort_stdin(proc: asyncio.subprocess.Process | None) -> None:
    if proc is None or proc.stdin is None:
        return
    stdin = proc.stdin
    transport = getattr(stdin, "transport", None) or getattr(stdin, "_transport", None)
    if transport is None or getattr(transport, "_protocol", None) is None:
        return
    try:
        if not stdin.is_closing():
            stdin.close()
    except Exception:
        pass
    try:
        if getattr(transport, "_protocol", None) is not None and not getattr(transport, "_closing", False):
            transport.abort()
    except Exception:
        pass


def force_stop(state: _ExecState) -> None:
    """Kill the guest before anyone waits on its stdin pipe."""
    kill_process_group(state.proc)
    kill_processes_for_uid(state.guest_uid)
    _abort_stdin(state.proc)


def _remove_work(parent: Path, *, as_guest: bool) -> None:
    """Delete a work directory.

    With cap_drop ALL the runner has no CAP_DAC_OVERRIDE, so it cannot unlink
    files inside a guest-owned 0700 directory. The guest uid empties `home`,
    then root removes the empty directories it owns.
    """
    home = parent / "home"
    if not as_guest or os.geteuid() != 0:
        shutil.rmtree(parent, ignore_errors=True)
        return
    uid = None
    try:
        if home.exists():
            uid = home.stat().st_uid
    except OSError:
        uid = None
    if uid and uid > 0 and uid != os.geteuid():
        try:
            subprocess.run(
                [sys.executable, "-I", "-B", "-c", _CLEANUP, str(home)],
                user=uid,
                group=uid,
                extra_groups=[],
                umask=0o077,
                cwd="/",
                env=guest_env("/"),
                timeout=3,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            pass
        try:
            os.rmdir(home)
        except OSError:
            pass
    shutil.rmtree(parent, ignore_errors=True)
    if home.exists():
        try:
            os.rmdir(home)
        except OSError:
            pass
    try:
        os.rmdir(parent)
    except OSError:
        pass


def sweep_guest_root(root: Path, *, privileged: bool) -> None:
    try:
        children = list(root.iterdir())
    except OSError:
        return
    for child in children:
        if child.is_dir():
            _remove_work(child, as_guest=privileged)


def ensure_guest_root(allow_same_uid: bool) -> Path:
    """Root-owned parent, mode 0711: traversable, not world-listable.

    Not /tmp. /tmp is 1777 and any guest can list another guest's directory.
    """
    global _guest_root
    root = guest_root_path()
    privileged = not allow_same_uid and os.geteuid() == 0
    try:
        root.mkdir(parents=True, exist_ok=True)
        os.chmod(root, 0o711 if privileged else 0o700)
    except OSError:
        if privileged:
            raise
        root = Path(tempfile.mkdtemp(prefix="ananta-guest-root-"))
        os.chmod(root, 0o700)
    sweep_guest_root(root, privileged=privileged)
    _guest_root = root
    return root


def _allocate_work(identity: tuple[int, int] | None, root: Path) -> Path:
    parent = root / secrets.token_hex(8)
    parent.mkdir(mode=0o700)
    os.chmod(parent, 0o711 if identity is not None else 0o700)
    home = parent / "home"
    home.mkdir(mode=0o700)
    os.chmod(home, 0o700)
    if identity is not None:
        os.chown(home, identity[0], identity[1])
    return parent


def _write_bootstrap(fd: int, data: bytes, proc: asyncio.subprocess.Process) -> None:
    os.set_blocking(fd, False)
    view = memoryview(data)
    deadline = time.monotonic() + 5
    try:
        while view:
            if time.monotonic() > deadline or proc.returncode is not None:
                return
            try:
                written = os.write(fd, view)
            except BlockingIOError:
                time.sleep(0.01)
                continue
            except OSError:
                return
            view = view[written:]
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


async def _start_guest(script: str, home: str, identity: tuple[int, int] | None, state: _ExecState):
    read_fd, write_fd = os.pipe()
    os.set_inheritable(read_fd, True)
    env = guest_env(home)
    env["ANANTA_BOOTSTRAP_FD"] = str(read_fd)
    kwargs: dict = {"umask": 0o077}
    if identity is not None:
        kwargs["user"] = identity[0]
        kwargs["group"] = identity[1]
        kwargs["extra_groups"] = []
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-I",
            "-B",
            "-u",
            "-c",
            _BOOT_LOADER,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
            pass_fds=(read_fd,),
            **kwargs,
        )
    except Exception:
        os.close(read_fd)
        os.close(write_fd)
        raise
    os.close(read_fd)
    state.proc = proc
    # The loader chdirs to HOME. Passing cwd=home would chdir as root before
    # setuid, which fails on a guest-owned 0700 directory without CAP_DAC_OVERRIDE.
    write_task = asyncio.create_task(asyncio.to_thread(_write_bootstrap, write_fd, script.encode(), proc))
    return proc, write_task


def reap_guest_zombies(uid: int | None, skip_pid: int | None = None) -> None:
    """Reap guests reparented to the runner after setsid.

    asyncio's child watcher only waits for the process it spawned. A grandchild
    whose parent already exited is adopted by pid 1 and stays a zombie until
    this process calls waitpid. Those zombies still show up in /proc. The
    spawned leader is left for that watcher.
    """
    if uid is None:
        return
    for pid in _pids_for_uid(uid, os.getpid()):
        if pid == skip_pid:
            continue
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass


async def _reap_when_leader_exits(proc: asyncio.subprocess.Process, uid: int | None) -> None:
    """Once the direct child exits, kill setsid descendants so they release the pipes.

    Process.wait() stays pending until stdout and stderr close, so a grandchild
    that inherited those pipes hides the leader's exit from wait(). The
    transport's returncode is set as soon as the leader itself exits.
    """
    try:
        while proc.returncode is None:
            await asyncio.sleep(0.05)
    except asyncio.CancelledError:
        raise
    kill_processes_for_uid(uid)
    kill_process_group(proc)
    await asyncio.sleep(0.05)
    reap_guest_zombies(uid, skip_pid=proc.pid)


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
        _abort_after = False
        stdin = self.proc.stdin
        if stdin is None:
            return
        transport = getattr(stdin, "transport", None) or getattr(stdin, "_transport", None)
        try:
            if not stdin.is_closing():
                stdin.close()
            await asyncio.wait_for(stdin.wait_closed(), timeout=0.5)
        except Exception:
            _abort_after = True
        if _abort_after and transport is not None:
            try:
                transport.abort()
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


async def execute(code: str, api_source: str, timeout_seconds: int, rpc, *, allow_same_uid: bool, slot: _Slot, state: _ExecState) -> dict:
    try:
        identity = guest_identity(allow_same_uid, slot)
    except RuntimeError as exc:
        return {"stdout": "", "stderr": str(exc), "exit_code": 1, "truncated": False}
    state.guest_uid = None if identity is None else identity[0]
    root = _guest_root if _guest_root is not None else ensure_guest_root(allow_same_uid)
    work = None
    proc = None
    watcher = None
    write_task = None
    bridge: asyncio.Task | None = None
    rpc_prefix = f"@@ANANTA_RPC:{secrets.token_hex(16)} "
    try:
        work = _allocate_work(identity, root)
        home = str(work / "home")
        script = guest_program(
            code,
            api_source,
            cpu_seconds=timeout_seconds,
            limit_nproc=identity is not None,
            rpc_prefix=rpc_prefix,
        )
        proc, write_task = await _start_guest(script, home, identity, state)
        watcher = asyncio.create_task(_reap_when_leader_exits(proc, state.guest_uid))
        bridge = asyncio.create_task(
            collect_bridge(_Pipes(proc), rpc, max_output_bytes=65536, prefix=rpc_prefix.encode())
        )
        try:
            stdout, stderr, exit_code, truncated = await asyncio.wait_for(
                asyncio.shield(bridge),
                timeout=timeout_seconds + 1,
            )
        except asyncio.TimeoutError:
            force_stop(state)
            bridge.cancel()
            await _wait_task(bridge, 1)
            return {"stdout": "", "stderr": "execution timed out", "exit_code": 124, "truncated": False}
        except asyncio.CancelledError:
            force_stop(state)
            bridge.cancel()
            await _wait_task(bridge, 1)
            raise
        except (ValueError, ConnectionError, asyncio.LimitOverrunError) as exc:
            force_stop(state)
            if bridge is not None and not bridge.done():
                bridge.cancel()
            return {"stdout": "", "stderr": str(exc)[:4000], "exit_code": 1, "truncated": False}
        return {"stdout": stdout, "stderr": stderr, "exit_code": int(exit_code), "truncated": bool(truncated)}
    finally:
        force_stop(state)
        if watcher is not None:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)
        if bridge is not None and not bridge.done():
            bridge.cancel()
            await asyncio.gather(bridge, return_exceptions=True)
        if state.guest_uid is not None:
            kill_processes_for_uid(state.guest_uid)
        if write_task is not None:
            try:
                await asyncio.wait_for(write_task, 1)
            except Exception:
                pass
        if proc is not None and proc.returncode is None:
            try:
                await asyncio.wait_for(proc.wait(), 1)
            except Exception:
                pass
        if state.guest_uid is not None:
            kill_processes_for_uid(state.guest_uid)
            reap_guest_zombies(state.guest_uid, skip_pid=None if proc is None else proc.pid)
        if work is not None:
            await asyncio.to_thread(_remove_work, work, as_guest=identity is not None)


def tokens_match(provided: str, expected: str) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())


async def _send(writer: asyncio.StreamWriter, payload: dict) -> None:
    writer.write((json.dumps(payload, allow_nan=False) + "\n").encode())
    await writer.drain()


def _consume_future_exception(fut: asyncio.Future) -> None:
    if fut.cancelled():
        return
    try:
        fut.exception()
    except Exception:
        pass


def _fail_pending(pending: dict, exc: BaseException) -> None:
    for fut in list(pending.values()):
        if not fut.done():
            fut.set_exception(exc)
            fut.add_done_callback(_consume_future_exception)


async def _wait_task(task: asyncio.Task, timeout: float) -> None:
    """Wait out a cancelled guest without treating its CancelledError as ours."""
    try:
        await asyncio.wait_for(task, timeout)
    except asyncio.CancelledError:
        if asyncio.current_task() is not None and asyncio.current_task().cancelling():
            raise
    except Exception:
        pass


async def _hold_slot(state: _ExecState, code, api_source, timeout, rpc, allow_same_uid) -> dict:
    queue = _slot_queue()
    slot = await queue.get()
    state.slot = slot
    task = None
    try:
        task = asyncio.create_task(
            execute(code, api_source, timeout, rpc, allow_same_uid=allow_same_uid, slot=slot, state=state)
        )
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=timeout + OUTER_MARGIN_SECONDS)
        except asyncio.TimeoutError:
            force_stop(state)
            task.cancel()
            await _wait_task(task, 3)
            return {"stdout": "", "stderr": "execution timed out", "exit_code": 124, "truncated": False}
        except asyncio.CancelledError:
            force_stop(state)
            task.cancel()
            await _wait_task(task, 3)
            if asyncio.current_task() is not None and asyncio.current_task().cancelling():
                raise
            raise
    finally:
        force_stop(state)
        if task is not None and not task.done():
            task.cancel()
            await _wait_task(task, 2)
        state.proc = None
        state.guest_uid = None
        state.slot = None
        queue.put_nowait(slot)


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
            try:
                while True:
                    try:
                        raw = await reader.readline()
                    except asyncio.LimitOverrunError:
                        _fail_pending(pending, ConnectionError("rpc reply exceeds the transport size limit"))
                        return
                    except (ConnectionError, OSError):
                        _fail_pending(pending, ConnectionError("backend closed"))
                        return
                    if not raw:
                        _fail_pending(pending, ConnectionError("backend closed"))
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
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                _fail_pending(pending, exc)

        async def rpc(frame):
            fut = loop.create_future()
            pending[frame.get("id")] = fut
            try:
                await _send(writer, {"type": "rpc", "exec_id": exec_id, "frame": frame})
                return await fut
            finally:
                pending.pop(frame.get("id"), None)

        state = _ExecState()
        exec_task = asyncio.create_task(_hold_slot(state, code, api_source, timeout, rpc, allow_same_uid))
        reader_task = asyncio.create_task(reader_loop())
        try:
            finished, _pending_tasks = await asyncio.wait(
                {exec_task, reader_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            reader_failed = reader_task in finished and not exec_task.done()
            if reader_failed:
                # EOF or a reader error: cancel the guest and free the slot now,
                # including when it is only sleeping or computing.
                force_stop(state)
                exec_task.cancel()
                await _wait_task(exec_task, 3)
                return
            if not exec_task.done():
                force_stop(state)
                exec_task.cancel()
                try:
                    await asyncio.wait_for(exec_task, 3)
                except Exception:
                    pass
                await _send(writer, {
                    "type": "result",
                    "exec_id": exec_id,
                    "stdout": "",
                    "stderr": "execution timed out",
                    "exit_code": 124,
                    "truncated": False,
                })
                return
            try:
                result = exec_task.result()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await _send(writer, {"type": "error", "exec_id": exec_id, "error": str(exc)[:4000], "exit_code": 1})
                return
            await _send(writer, {"type": "result", "exec_id": exec_id, **result})
        finally:
            reader_task.cancel()
            if not exec_task.done():
                force_stop(state)
                exec_task.cancel()
            await asyncio.gather(reader_task, exec_task, return_exceptions=True)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def serve(socket_path: str, token: str, *, allow_same_uid: bool = False) -> asyncio.Server:
    ensure_guest_root(allow_same_uid)
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
        server = await asyncio.start_unix_server(client, path=str(path), limit=MESSAGE_LIMIT)
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
        help="Test-only. Do not use in the container; guests would share the runner uid.",
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
