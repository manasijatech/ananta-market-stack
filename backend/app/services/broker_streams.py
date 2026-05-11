from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


class BrokerStreamRegistry:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: dict[str, int] = defaultdict(int)
        self._subscriptions: dict[str, list[dict[str, Any]]] = defaultdict(list)

    async def attach(self, account_id: str) -> None:
        async with self._lock:
            self._connections[account_id] += 1

    async def detach(self, account_id: str) -> None:
        async with self._lock:
            self._connections[account_id] = max(0, self._connections.get(account_id, 0) - 1)
            if self._connections[account_id] == 0:
                self._subscriptions.pop(account_id, None)

    async def set_subscriptions(self, account_id: str, instruments: list[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscriptions[account_id] = instruments

    async def clear_subscriptions(self, account_id: str) -> None:
        async with self._lock:
            self._subscriptions[account_id] = []

    async def status(self, account_id: str) -> dict[str, Any]:
        async with self._lock:
            return {
                "subscription_count": len(self._subscriptions.get(account_id, [])),
                "subscriptions": list(self._subscriptions.get(account_id, [])),
                "connection_count": self._connections.get(account_id, 0),
            }


stream_registry = BrokerStreamRegistry()
