from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI

from app.api.v1 import api_router
from app.config import get_settings
from app.services.alerts import ensure_system_templates
from app.services.broker_sessions import maintenance_loop
from db.session import SessionLocal
from db.session import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        ensure_system_templates(db)
    finally:
        db.close()
    stop_event = asyncio.Event()
    task = asyncio.create_task(maintenance_loop(stop_event))
    yield
    stop_event.set()
    await task


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
