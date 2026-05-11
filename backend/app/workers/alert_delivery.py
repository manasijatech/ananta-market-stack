from __future__ import annotations

import asyncio

from app.services.alert_runtime import run_alert_delivery_worker


async def _main() -> None:
    stop_event = asyncio.Event()
    await run_alert_delivery_worker(stop_event)


if __name__ == "__main__":
    asyncio.run(_main())
