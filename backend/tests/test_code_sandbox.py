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
