"""Bounded guest RPC framing; stdout chunk boundaries are not line boundaries."""
import asyncio
import json

PREFIX = b'@@ANANTA_RPC '
MAX_FRAME_BYTES = 262144
MAX_CALLS = 40
MAX_BATCH = 8


async def collect_bridge(execution, rpc, *, max_output_bytes, prefix=PREFIX):
    """`prefix` carries a per-exec nonce so printed data cannot forge RPC frames."""
    prefix_ = prefix
    stdin = execution.stdin()
    calls = 0
    truncated = False

    async def read(stream, frames=False):
        nonlocal calls, truncated
        output = bytearray()
        pending = bytearray()
        passthrough = False

        async def line(data, allow_frame=True):
            nonlocal calls, truncated
            if frames and allow_frame and data.startswith(prefix_):
                frame = json.loads(data[len(prefix_):])
                if not isinstance(frame, dict):
                    raise ValueError('invalid RPC frame')
                batch = frame.get('calls')
                if (type(frame.get('id')) is not int or not isinstance(batch, list)
                        or not 1 <= len(batch) <= MAX_BATCH
                        or any(not isinstance(c, dict) or not isinstance(c.get('name'), str)
                               or not isinstance(c.get('args'), dict) for c in batch)):
                    raise ValueError('invalid RPC frame')
                calls += len(batch)
                if calls > MAX_CALLS:
                    raise ValueError('RPC call budget exceeded')
                reply = await rpc(frame)
                if reply.get('id') != frame['id'] or len(reply.get('results', [])) != len(batch):
                    raise ValueError('invalid RPC reply')
                await stdin.send_input((json.dumps(reply, allow_nan=False) + '\n').encode())
            else:
                take = max(0, max_output_bytes - len(output))
                output.extend(data[:take])
                truncated |= len(data) > take

        async for chunk in stream():
            pending.extend(chunk.encode() if isinstance(chunk, str) else chunk)
            while b'\n' in pending:
                end = pending.index(10) + 1
                if frames and not passthrough and pending.startswith(prefix_) and end > MAX_FRAME_BYTES:
                    raise ValueError('RPC/stdout line exceeds frame limit')
                data = bytes(pending[:end])
                del pending[:end]
                await line(data, not passthrough)
                passthrough = False
            if len(pending) > MAX_FRAME_BYTES:
                if frames and not passthrough and pending.startswith(prefix_):
                    raise ValueError('RPC frame exceeds frame limit')
                await line(bytes(pending), False)
                passthrough = True
                pending.clear()
        if pending:
            if frames and not passthrough and pending.startswith(prefix_):
                raise ValueError('unterminated RPC frame')
            await line(bytes(pending), not passthrough)
        return output.decode('utf-8', errors='replace')

    tasks = [asyncio.create_task(read(execution.stdout, True)),
             asyncio.create_task(read(execution.stderr)), asyncio.ensure_future(execution.wait())]
    try:
        stdout, stderr, result = await asyncio.gather(*tasks)
        return stdout, stderr, int(result.exit_code or 0), truncated
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        import inspect
        try:
            closed = stdin.close()
            if inspect.isawaitable(closed):
                await asyncio.wait_for(closed, timeout=1)
        except Exception:
            abort = getattr(stdin, "abort", None)
            transport = getattr(stdin, "transport", None) or getattr(stdin, "_transport", None)
            try:
                if callable(abort):
                    abort()
                elif transport is not None and hasattr(transport, "abort"):
                    transport.abort()
            except Exception:
                pass
