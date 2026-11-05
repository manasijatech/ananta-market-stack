"""Frame limits and a real guest subprocess, without Docker."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.agent_harness.code_mode import generate_api
from app.config import get_settings

ROOT = Path(__file__).resolve().parents[2]
SANDBOX = ROOT / "code_sandbox"


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SANDBOX / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


bridge = _load("ananta_code_sandbox_bridge", "bridge.py")
runner = _load("ananta_code_sandbox_main", "main.py")


class Execution:
    def __init__(self, chunks):
        self.chunks = chunks
        self.replies = []

    def stdin(self):
        return self

    async def close(self):
        return None

    async def send_input(self, data):
        self.replies.append(json.loads(data))

    async def stdout(self):
        for chunk in self.chunks:
            yield chunk

    async def stderr(self):
        yield b"warning"

    async def wait(self):
        return SimpleNamespace(exit_code=0)


@pytest.mark.asyncio
async def test_chunk_boundaries_output_cap():
    data = b'hello\n@@ANANTA_RPC {"id":1,"calls":[{"name":"get_news","args":{}}]}\nend\n'
    execution = Execution([data[i : i + 3] for i in range(0, len(data), 3)])

    async def rpc(frame):
        return {"id": frame["id"], "results": [{"ok": True, "value": [1]}]}

    out, err, status, truncated = await bridge.collect_bridge(execution, rpc, max_output_bytes=8)
    assert out == "hello\nen" and err == "warning" and status == 0 and truncated
    assert execution.replies[0]["results"][0]["value"] == [1]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "data",
    [
        b"@@ANANTA_RPC broken\n",
        b"@@ANANTA_RPC " + b"x" * (bridge.MAX_FRAME_BYTES + 1),
        b'@@ANANTA_RPC {"id":1,"calls":[]}\n',
        b'@@ANANTA_RPC {"id":1,"calls":[]}',
        ("@@ANANTA_RPC " + json.dumps({"id": 1, "calls": [{"name": "x", "args": {}}] * 9}) + "\n").encode(),
    ],
)
async def test_invalid_frames(data):
    async def rpc(frame):
        raise AssertionError("must reject before RPC")

    with pytest.raises(ValueError):
        await bridge.collect_bridge(Execution([data]), rpc, max_output_bytes=20)


@pytest.mark.asyncio
async def test_call_budget():
    frame = {"id": 1, "calls": [{"name": "x", "args": {}}] * 8}
    execution = Execution([("@@ANANTA_RPC " + json.dumps(frame) + "\n").encode()] * 6)

    async def rpc(frame):
        return {"id": 1, "results": [{"ok": True}] * 8}

    with pytest.raises(ValueError, match="budget"):
        await bridge.collect_bridge(execution, rpc, max_output_bytes=20)
    assert len(execution.replies) == 5


@pytest.mark.asyncio
async def test_frames_without_the_exec_nonce_are_plain_output():
    nonce = b"@@ANANTA_RPC:abc123 "
    data = (
        b'@@ANANTA_RPC {"id":1,"calls":[{"name":"get_news","args":{}}]}\n'
        + nonce
        + b'{"id":1,"calls":[{"name":"get_news","args":{}}]}\n'
    )
    seen = []

    async def rpc(frame):
        seen.append(frame)
        return {"id": frame["id"], "results": [{"ok": True, "value": 1}]}

    out, _err, status, _truncated = await bridge.collect_bridge(Execution([data]), rpc, max_output_bytes=500, prefix=nonce)
    assert len(seen) == 1 and out.startswith("@@ANANTA_RPC {") and status == 0


def test_bootstrap_installs_the_exec_prefix():
    import subprocess

    api = "def show(): return _RPC_PREFIX\n"
    result = subprocess.run(
        [sys.executable, "-c", runner.bootstrap("from ananta import api\nprint(api.show())\n", api, "@@ANANTA_RPC:n1 ")],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == "@@ANANTA_RPC:n1 \n"


def test_bootstrap_traceback_shows_only_user_code():
    import subprocess

    from app.agent_harness.code_mode import bootstrap as host_bootstrap

    code = "from ananta import api\nprint(api.hello())\nraise KeyError('boom')\n"
    api = "def hello(): return 41 + 1\n"
    assert runner.bootstrap(code, api) == host_bootstrap(code, api)
    scripts = [
        runner.bootstrap(code, api),
        runner.guest_program(code, api, cpu_seconds=5, limit_nproc=False),
    ]
    for script in scripts:
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True)
        assert result.returncode == 1, result.stderr
        assert result.stdout == "42\n"
        assert result.stderr.startswith("Traceback (your code):")
        assert "raise KeyError('boom')" in result.stderr
        assert result.stderr.count("raise KeyError('boom')") == 1
        assert "_api_source" not in result.stderr
        assert "_code = " not in result.stderr
        assert "exec(compile" not in result.stderr
        assert "<code_run>" in result.stderr

    exiting = subprocess.run(
        [sys.executable, "-c", runner.bootstrap("import sys\nsys.exit(3)\n", "")],
        capture_output=True,
        text=True,
    )
    assert exiting.returncode == 3
    assert exiting.stderr == ""


def test_privilege_drop_refuses_when_not_root():
    if os.geteuid() == 0:
        identity = runner.guest_identity(False)
        assert identity is not None
        assert identity[0] != 0
        return
    with pytest.raises(RuntimeError, match="privileg"):
        runner.guest_identity(False)
    assert runner.guest_identity(True) is None


def _tool():
    return SimpleNamespace(
        name="broker_get_quotes",
        description="Read quotes.",
        params_json_schema={"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"]},
    )


@pytest.mark.asyncio
async def test_runner_process_rpc_timeout_frames_and_env(monkeypatch):
    """Spawn the runner as its own process and a guest subprocess inside it."""
    if os.geteuid() != 0:
        with pytest.raises(RuntimeError, match="privileg"):
            runner.guest_identity(False)

    directory = tempfile.TemporaryDirectory(prefix="ananta-code-", dir="/tmp")
    root = Path(directory.name)
    socket_path = str(root / "runner.sock")
    token_path = root / "token"
    token_path.write_text("test-token", encoding="utf-8")
    allow_same = os.geteuid() != 0
    env = os.environ.copy()
    env["ANANTA_PARENT_SECRET"] = "leak-me"
    env["CODE_SANDBOX_SOCKET"] = socket_path
    env["CODE_SANDBOX_TOKEN_FILE"] = str(token_path)
    command = [
        sys.executable,
        str(SANDBOX / "main.py"),
        "--socket",
        socket_path,
        "--token-file",
        str(token_path),
    ]
    if allow_same:
        command.append("--allow-same-uid")
    proc = await asyncio.create_subprocess_exec(
        *command,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        for _ in range(50):
            if os.path.exists(socket_path):
                break
            if proc.returncode is not None:
                err = (await proc.stderr.read()).decode()
                raise AssertionError(f"runner exited early: {err}")
            await asyncio.sleep(0.05)
        else:
            err = (await proc.stderr.read()).decode()
            raise AssertionError(f"socket did not appear: {err}")

        monkeypatch.setenv("CODE_SANDBOX_SOCKET", socket_path)
        monkeypatch.setenv("CODE_SANDBOX_TOKEN_FILE", str(token_path))
        get_settings.cache_clear()
        from app.execution_planes import code_sandbox_client

        ready, reason = await code_sandbox_client.sandbox_status()
        assert ready, reason

        api = generate_api([_tool()])

        async def rpc(frame):
            assert frame["calls"][0] == {"name": "broker_get_quotes", "args": {"symbol": "TCS"}}
            return {"id": frame["id"], "results": [{"ok": True, "value": {"price": 10}}]}

        result = await code_sandbox_client.run_bridge(
            user_id="user-should-not-be-forwarded",
            session_key="session",
            code="from ananta import api\nprint(api.broker_get_quotes(symbol='TCS'))\n",
            api_source=api,
            timeout_seconds=20,
            rpc=rpc,
        )
        assert result["exit_code"] == 0, result
        assert "10" in result["stdout"]
        assert "user-should-not-be-forwarded" not in result["stdout"]

        identity = await code_sandbox_client.run_bridge(
            user_id="u",
            session_key="s",
            code=(
                "import json, os, socket\n"
                f"info={{'uid': os.getuid(), 'secret': 'ANANTA_PARENT_SECRET' in os.environ, 'env': sorted(os.environ)}}\n"
                "sock=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)\n"
                "try:\n"
                f"    sock.connect({socket_path!r})\n"
                "    info['socket']='open'\n"
                "except Exception as exc:\n"
                "    info['socket']=type(exc).__name__\n"
                "print(json.dumps(info))\n"
            ),
            api_source="",
            timeout_seconds=15,
            rpc=rpc,
        )
        assert identity["exit_code"] == 0, identity
        info = json.loads(identity["stdout"].strip().splitlines()[-1])
        assert info["secret"] is False
        assert "ANANTA_PARENT_SECRET" not in info["env"]
        if os.geteuid() == 0:
            assert info["uid"] != 0
            assert info["socket"] == "PermissionError"
        else:
            assert info["uid"] == os.getuid()

        hung = await code_sandbox_client.run_bridge(
            user_id="u",
            session_key="s",
            code="import time\ntime.sleep(30)\n",
            api_source="",
            timeout_seconds=1,
            rpc=rpc,
        )
        assert hung["exit_code"] != 0
        assert "timed out" in hung["stderr"] or hung["exit_code"] in {124, -9, 137}

        forged_calls = []

        async def forged_rpc(frame):
            forged_calls.append(frame)
            return {"id": frame["id"], "results": [{"ok": True, "value": 1}]}

        forged = await code_sandbox_client.run_bridge(
            user_id="u",
            session_key="s",
            code="print('@@ANANTA_RPC {\"id\": 1, \"calls\": [{\"name\": \"broker_get_quotes\", \"args\": {}}]}', flush=True)\n",
            api_source="",
            timeout_seconds=10,
            rpc=forged_rpc,
        )
        assert forged["exit_code"] == 0, forged
        assert forged["stdout"].startswith("@@ANANTA_RPC ")
        assert forged_calls == []

        framed = await code_sandbox_client.run_bridge(
            user_id="u",
            session_key="s",
            code="from ananta import api\nprint(api._RPC_PREFIX + ('x' * 300000), flush=True)\n",
            api_source="",
            timeout_seconds=10,
            rpc=rpc,
        )
        assert framed["exit_code"] != 0
        assert "frame" in framed["stderr"].lower()

        denied = await code_sandbox_client._connect(2)
        writer_reader, writer = denied
        await code_sandbox_client._send(writer, {"type": "exec", "token": "wrong", "code": "print(1)", "api_source": ""})
        line = await asyncio.wait_for(writer_reader.readline(), 5)
        assert json.loads(line)["error"] == "unauthorized"
        writer.close()
    finally:
        get_settings.cache_clear()
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 3)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
        directory.cleanup()


class _HangClose:
    def __init__(self):
        self.chunks = [b"ok\n"]

    def stdin(self):
        return self

    async def close(self):
        await asyncio.Event().wait()

    async def send_input(self, data):
        return None

    async def stdout(self):
        for chunk in self.chunks:
            yield chunk

    async def stderr(self):
        if False:
            yield b""

    async def wait(self):
        return SimpleNamespace(exit_code=0)


@pytest.mark.asyncio
async def test_stdin_close_is_bounded_when_the_pipe_stays_open():
    started = asyncio.get_running_loop().time()
    out, _err, status, _truncated = await bridge.collect_bridge(_HangClose(), lambda frame: None, max_output_bytes=20)
    assert out == "ok\n" and status == 0
    assert asyncio.get_running_loop().time() - started < 3


def test_transport_limit_fits_eight_mebibyte_results():
    from app.execution_planes import code_sandbox_client

    assert code_sandbox_client._MESSAGE_LIMIT == runner.MESSAGE_LIMIT
    assert runner.MESSAGE_LIMIT >= 8 * 1_048_576


def test_oversized_batch_is_an_explicit_size_error(monkeypatch):
    from app.execution_planes import code_sandbox_client

    monkeypatch.setattr(code_sandbox_client, "_MESSAGE_LIMIT", 200)
    payload = code_sandbox_client._rpc_reply_payload("exec", {"id": 7, "results": [{"ok": True, "value": "a" * 800}]})
    assert payload["reply"]["id"] == 7
    assert "transport size limit" in payload["reply"]["results"][0]["error"]
    encoded = json.dumps(payload).encode()
    assert len(encoded) <= 200


class RunnerHarness:
    def __init__(self):
        self.directory = None
        self.proc = None
        self.socket_path = ""
        self.token_path = None
        self.guest_root = None

    async def __aenter__(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ananta-code-", dir="/tmp")
        root = Path(self.directory.name)
        self.socket_path = str(root / "runner.sock")
        self.token_path = root / "token"
        self.token_path.write_text("test-token", encoding="utf-8")
        self.guest_root = root / "guests"
        self.guest_root.mkdir()
        env = os.environ.copy()
        env["ANANTA_GUEST_ROOT"] = str(self.guest_root)
        env["CODE_SANDBOX_SOCKET"] = self.socket_path
        env["CODE_SANDBOX_TOKEN_FILE"] = str(self.token_path)
        command = [sys.executable, str(SANDBOX / "main.py"), "--socket", self.socket_path, "--token-file", str(self.token_path)]
        if os.geteuid() != 0:
            command.append("--allow-same-uid")
        self.proc = await asyncio.create_subprocess_exec(
            *command,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        for _ in range(50):
            if os.path.exists(self.socket_path):
                return self
            if self.proc.returncode is not None:
                err = (await self.proc.stderr.read()).decode()
                raise AssertionError(f"runner exited early: {err}")
            await asyncio.sleep(0.05)
        err = (await self.proc.stderr.read()).decode()
        raise AssertionError(f"socket did not appear: {err}")

    async def __aexit__(self, exc_type, exc, tb):
        get_settings.cache_clear()
        if self.proc is not None and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 3)
            except asyncio.TimeoutError:
                self.proc.kill()
                await self.proc.wait()
        if self.directory is not None:
            self.directory.cleanup()

    def configure(self, monkeypatch):
        monkeypatch.setenv("CODE_SANDBOX_SOCKET", self.socket_path)
        monkeypatch.setenv("CODE_SANDBOX_TOKEN_FILE", str(self.token_path))
        get_settings.cache_clear()


async def _raw_exec(socket_path, code, timeout):
    limit = runner.MESSAGE_LIMIT
    reader, writer = await asyncio.open_unix_connection(socket_path, limit=limit)
    payload = {
        "type": "exec",
        "token": "test-token",
        "exec_id": "t",
        "code": code,
        "api_source": "",
        "timeout_seconds": timeout,
    }
    writer.write((json.dumps(payload) + "\n").encode())
    await writer.drain()
    return reader, writer


@pytest.mark.asyncio
async def test_stuck_stdin_releases_the_slot(monkeypatch):
    from app.execution_planes import code_sandbox_client

    async with RunnerHarness() as harness:
        harness.configure(monkeypatch)
        api = generate_api([_tool()])

        async def rpc(frame):
            return {"id": frame["id"], "results": [{"ok": True, "value": "a" * 200_000}]}

        code = (
            "import sys, time\n"
            "from ananta import api\n"
            "sys.stdout.write('\\n' + api._RPC_PREFIX + "
            "'{\"id\": 1, \"calls\": [{\"name\": \"broker_get_quotes\", \"args\": {\"symbol\": \"TCS\"}}]}\\n')\n"
            "sys.stdout.flush()\n"
            "time.sleep(30)\n"
        )

        async def once():
            started = asyncio.get_running_loop().time()
            result = await code_sandbox_client.run_bridge(
                user_id="u", session_key="s", code=code, api_source=api, timeout_seconds=3, rpc=rpc
            )
            return asyncio.get_running_loop().time() - started, result

        (left_dt, left), (right_dt, right) = await asyncio.gather(once(), once())
        assert left_dt < 12 and right_dt < 12, (left_dt, right_dt, left, right)
        assert left["exit_code"] == 124 and right["exit_code"] == 124
        follow = await code_sandbox_client.run_bridge(
            user_id="u", session_key="s", code="print('free')\n", api_source="", timeout_seconds=5, rpc=rpc
        )
        assert follow["exit_code"] == 0 and "free" in follow["stdout"]
        assert list(harness.guest_root.iterdir()) == []


@pytest.mark.asyncio
async def test_parent_exit_kills_detached_child(monkeypatch):
    from app.execution_planes import code_sandbox_client

    async with RunnerHarness() as harness:
        harness.configure(monkeypatch)

        async def rpc(frame):
            raise AssertionError(frame)

        result = await code_sandbox_client.run_bridge(
            user_id="u",
            session_key="s",
            code=(
                "import subprocess\n"
                "p = subprocess.Popen(['sleep', '30'], stdin=subprocess.DEVNULL, "
                "stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
                "print(p.pid, flush=True)\n"
            ),
            api_source="",
            timeout_seconds=8,
            rpc=rpc,
        )
        assert result["exit_code"] == 0, result
        pid = int(result["stdout"].strip().splitlines()[-1])
        cmdline = Path(f"/proc/{pid}/cmdline")
        if cmdline.exists():
            assert b"sleep" not in cmdline.read_bytes()


@pytest.mark.asyncio
async def test_setsid_grandchild_is_killed_when_root(monkeypatch):
    if os.geteuid() != 0:
        pytest.skip("uid reap needs root")
    from app.execution_planes import code_sandbox_client

    async with RunnerHarness() as harness:
        harness.configure(monkeypatch)

        async def rpc(frame):
            raise AssertionError(frame)

        result = await code_sandbox_client.run_bridge(
            user_id="u",
            session_key="s",
            code=(
                "import os, sys, time\n"
                "sys.stdout.write('parent-done\\n')\n"
                "sys.stdout.flush()\n"
                "if os.fork() == 0:\n"
                "    os.setsid()\n"
                "    if os.fork() == 0:\n"
                "        time.sleep(30)\n"
                "        os._exit(0)\n"
                "    os._exit(0)\n"
                "os._exit(0)\n"
            ),
            api_source="",
            timeout_seconds=6,
            rpc=rpc,
        )
        assert result["exit_code"] == 0, result
        assert "parent-done" in result["stdout"]
        leftovers = []
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            try:
                text = Path(f"/proc/{entry}/status").read_text(encoding="utf-8")
            except OSError:
                continue
            for line in text.splitlines():
                if line.startswith("Uid:") and f" {runner.GUEST_UID_BASE} " in f" {line} ":
                    leftovers.append(entry)
        assert leftovers == []


async def _disconnect_pair(socket_path, code, timeout, *, wait_for_rpc=False):
    holders = []
    for _ in range(2):
        reader, writer = await _raw_exec(socket_path, code, timeout)
        holders.append((reader, writer))
    await asyncio.sleep(0.4)
    if wait_for_rpc:
        for reader, _writer in holders:
            while True:
                raw = await asyncio.wait_for(reader.readline(), 5)
                message = json.loads(raw)
                if message.get("type") == "rpc":
                    break
    for _reader, writer in holders:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
    await asyncio.sleep(0.3)
    reader, writer = await _raw_exec(socket_path, "print('free')\n", 5)
    try:
        raw = await asyncio.wait_for(reader.readline(), 6)
    finally:
        writer.close()
    message = json.loads(raw)
    assert message.get("exit_code") == 0, message
    assert "free" in (message.get("stdout") or "")


@pytest.mark.asyncio
async def test_disconnect_releases_sleep_cpu_and_rpc():
    async with RunnerHarness() as harness:
        await _disconnect_pair(harness.socket_path, "import time\ntime.sleep(30)\n", 20)
        await _disconnect_pair(harness.socket_path, "while True:\n    pass\n", 20)
        api = generate_api([_tool()])
        code = "from ananta import api\napi.broker_get_quotes(symbol='TCS')\n"
        # The raw exec helper sends an empty api. Re-send with the generated module.
        holders = []
        for _ in range(2):
            reader, writer = await asyncio.open_unix_connection(harness.socket_path, limit=runner.MESSAGE_LIMIT)
            writer.write((json.dumps({
                "type": "exec",
                "token": "test-token",
                "exec_id": "rpc",
                "code": code,
                "api_source": api,
                "timeout_seconds": 20,
            }) + "\n").encode())
            await writer.drain()
            holders.append((reader, writer))
        for reader, _writer in holders:
            while True:
                raw = await asyncio.wait_for(reader.readline(), 5)
                if json.loads(raw).get("type") == "rpc":
                    break
        for _reader, writer in holders:
            writer.close()
            await writer.wait_closed()
        await asyncio.sleep(0.3)
        reader, writer = await _raw_exec(harness.socket_path, "print('free')\n", 5)
        try:
            raw = await asyncio.wait_for(reader.readline(), 6)
        finally:
            writer.close()
        message = json.loads(raw)
        assert message.get("exit_code") == 0, message
        assert "free" in (message.get("stdout") or "")


@pytest.mark.asyncio
async def test_three_800kb_results_fit_on_the_socket(monkeypatch):
    from app.execution_planes import code_sandbox_client

    async with RunnerHarness() as harness:
        harness.configure(monkeypatch)
        api = generate_api([_tool()])

        async def rpc(frame):
            return {"id": frame["id"], "results": [{"ok": True, "value": "a" * 800_000} for _ in frame["calls"]]}

        result = await code_sandbox_client.run_bridge(
            user_id="u",
            session_key="s",
            code=(
                "from ananta import api\n"
                "vals = api.parallel([\n"
                "    ('broker_get_quotes', {'symbol': 'A'}),\n"
                "    ('broker_get_quotes', {'symbol': 'B'}),\n"
                "    ('broker_get_quotes', {'symbol': 'C'}),\n"
                "])\n"
                "print([len(v) for v in vals])\n"
            ),
            api_source=api,
            timeout_seconds=20,
            rpc=rpc,
        )
        assert result["exit_code"] == 0, result
        assert "[800000, 800000, 800000]" in result["stdout"]


@pytest.mark.asyncio
async def test_backend_deadline_cancels_a_hung_tool(monkeypatch):
    from app.execution_planes import code_sandbox_client

    monkeypatch.setattr(code_sandbox_client, "BRIDGE_DEADLINE_MARGIN", 1)
    async with RunnerHarness() as harness:
        harness.configure(monkeypatch)
        api = generate_api([_tool()])
        cancelled = asyncio.Event()

        async def rpc(frame):
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        started = asyncio.get_running_loop().time()
        with pytest.raises(TimeoutError):
            await code_sandbox_client.run_bridge(
                user_id="u",
                session_key="s",
                code="from ananta import api\napi.broker_get_quotes(symbol='TCS')\n",
                api_source=api,
                timeout_seconds=1,
                rpc=rpc,
            )
        elapsed = asyncio.get_running_loop().time() - started
        assert cancelled.is_set()
        assert elapsed < 5


@pytest.mark.asyncio
async def test_work_directories_are_removed(monkeypatch):
    from app.execution_planes import code_sandbox_client

    async with RunnerHarness() as harness:
        harness.configure(monkeypatch)

        async def rpc(frame):
            raise AssertionError(frame)

        for _ in range(12):
            result = await code_sandbox_client.run_bridge(
                user_id="u",
                session_key="s",
                code="open('blob','wb').write(b'x'*100000)\nprint('ok')\n",
                api_source="",
                timeout_seconds=10,
                rpc=rpc,
            )
            assert result["exit_code"] == 0, result
        assert list(harness.guest_root.iterdir()) == []
