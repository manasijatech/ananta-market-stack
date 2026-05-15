from contextlib import asynccontextmanager
import asyncio
import logging
import threading
from threading import Thread

from fastapi import FastAPI

from app.api.v1 import api_router
from app.config import get_settings
from app.services.alert_runtime import create_alert_worker_service
from app.services.alpha_websocket import run_alpha_websocket_worker
from app.services.broker_sessions import maintenance_loop
from app.services.system_maintenance import run_startup_maintenance
from app.services.watchlist_preset_worker import run_watchlist_preset_worker
from db.session import init_db

logger = logging.getLogger(__name__)
BACKGROUND_RESTART_DELAY_SECONDS = 5.0


class BackgroundAsyncLoopThread:
    def __init__(self, name: str, target) -> None:
        self.name = name
        self.target = target
        self.thread: Thread | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.stop_event: asyncio.Event | None = None
        self.ready = threading.Event()

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return

        def runner() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            stop_event = asyncio.Event()
            self.loop = loop
            self.stop_event = stop_event
            self.ready.set()
            try:
                while not stop_event.is_set():
                    try:
                        loop.run_until_complete(self.target(stop_event))
                        break
                    except Exception:
                        logger.exception("%s crashed; restarting in %.1fs", self.name, BACKGROUND_RESTART_DELAY_SECONDS)
                        if stop_event.is_set():
                            break
                        try:
                            loop.run_until_complete(
                                asyncio.wait_for(stop_event.wait(), timeout=BACKGROUND_RESTART_DELAY_SECONDS)
                            )
                        except TimeoutError:
                            continue
            finally:
                pending = asyncio.all_tasks(loop)
                for task in pending:
                    task.cancel()
                if pending:
                    loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                loop.close()

        self.ready.clear()
        self.thread = Thread(target=runner, name=self.name, daemon=True)
        self.thread.start()
        self.ready.wait(timeout=2)

    def stop(self, timeout: float = 0.5) -> None:
        if self.loop and self.stop_event:
            try:
                self.loop.call_soon_threadsafe(self.stop_event.set)
            except RuntimeError:
                pass
        if self.thread:
            self.thread.join(timeout=timeout)
        self.thread = None
        self.loop = None
        self.stop_event = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    try:
        run_startup_maintenance()
    except Exception:
        logger.exception("startup system maintenance failed")
    maintenance_service = _start_background_service("maintenance-loop", maintenance_loop)
    alert_worker_service = None
    if settings.enable_in_process_alert_workers:
        try:
            alert_worker_service = create_alert_worker_service()
            alert_worker_service.start()
        except Exception:
            logger.exception("alert-worker-service failed to start")
            alert_worker_service = None
    alpha_ws_worker_service = None
    if settings.enable_in_process_alpha_ws_worker:
        alpha_ws_worker_service = _start_background_service("alpha-ws-worker", run_alpha_websocket_worker)
    watchlist_preset_worker_service = None
    if settings.enable_in_process_watchlist_preset_worker:
        watchlist_preset_worker_service = _start_background_service(
            "watchlist-preset-worker",
            run_watchlist_preset_worker,
        )
    yield
    if maintenance_service:
        maintenance_service.stop()
    if alert_worker_service:
        alert_worker_service.stop()
    if alpha_ws_worker_service:
        alpha_ws_worker_service.stop()
    if watchlist_preset_worker_service:
        watchlist_preset_worker_service.stop()


def _start_background_service(name: str, target) -> BackgroundAsyncLoopThread | None:
    service = BackgroundAsyncLoopThread(name, target)
    try:
        service.start()
    except Exception:
        logger.exception("%s failed to start", name)
        return None
    return service


settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    description="""
# Market-Stack API
Modular trading/data platform for multi-broker account management.

### Key Features:
- **Multi-Broker CRUD**: Connect and manage multiple accounts for brokers like Zerodha, Upstox, Angel, etc.
- **Unified Operations**: Execute orders, fetch portfolios, and check funds using a consistent API across all brokers.
- **Automated Sessions**: Experimental and official session refresh flows for hands-free trading.
- **Quote Cache**: Direct access to real-time quotes with optional Redis write-through.

### Documentation for Frontend Integration:
- **X-User-Id Header**: Most endpoints require an `X-User-Id` header. In development, it defaults to `local-dev-user`.
- **Broker-Specific Flows**: See individual session endpoints for authentication redirects and token exchanges.
- **Extra Payload**: Use the `extra` field in order bodies for broker-specific parameters (e.g., `instrument_token`).

Refer to `AGENTS.md` in the repository for architectural details and implementation status.
""",
    version="1.0.0",
    lifespan=lifespan,
    contact={
        "name": "Market-Stack Support",
    },
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def root_health() -> dict:
    return {"status": "ok"}
