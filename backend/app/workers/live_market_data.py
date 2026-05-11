from __future__ import annotations

import asyncio

from app.services.alert_runtime import run_live_market_data_worker


async def _main() -> None:
    stop_event = asyncio.Event()
    await run_live_market_data_worker(stop_event)


if __name__ == "__main__":
    asyncio.run(_main())
