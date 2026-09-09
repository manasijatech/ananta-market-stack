from __future__ import annotations

import re
from pathlib import Path

oss = Path(r"c:\Apps\codes\work\ananta-market-stack")
ent = Path(r"c:\Apps\codes\work\ananta-market-stack-enterprise")

# --- config ---
cfg_path = oss / "backend/app/config.py"
cfg = cfg_path.read_text(encoding="utf-8")
if "compact_anxiety_ratio" not in cfg:
    block = """    compact_reserve_chars: int = Field(
        default=12_000,
        ge=2_000,
        validation_alias="COMPACT_RESERVE_CHARS",
    )
    compact_keep_recent_chars: int = Field(
        default=20_000,
        ge=4_000,
        validation_alias="COMPACT_KEEP_RECENT_CHARS",
    )
    compact_summary_max_chars: int = Field(
        default=3_500,
        ge=500,
        validation_alias="COMPACT_SUMMARY_MAX_CHARS",
    )
    compact_anxiety_ratio: float = Field(
        default=0.80,
        ge=0.50,
        le=0.95,
        validation_alias="COMPACT_ANXIETY_RATIO",
    )
    compact_timeout_seconds: float = Field(
        default=45.0,
        ge=5.0,
        validation_alias="COMPACT_TIMEOUT_SECONDS",
    )
    broker_chat_compaction_model: str = Field(
        default="",
        validation_alias="BROKER_CHAT_COMPACTION_MODEL",
    )
    enable_chat_embeddings: bool = Field(
        default=False,
        validation_alias="ENABLE_CHAT_EMBEDDINGS",
    )
"""
    cfg2, n = re.subn(
        r"(hooks_total_chars: int = Field\([\s\S]*?\n    \)\n)",
        r"\1" + block,
        cfg,
        count=1,
    )
    if n != 1:
        raise SystemExit(f"config patch failed n={n}")
    cfg_path.write_text(cfg2, encoding="utf-8")
    print("patched config")
else:
    print("config ok")

# --- models ---
models_path = oss / "backend/db/models.py"
models = models_path.read_text(encoding="utf-8")
if "compaction_summary_text" not in models:
    needle = """    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True
    )


class BrokerChatRun(Base):"""
    insert = """    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True
    )
    # Plan 06 — frozen model-facing session summary (audit remains full).
    compaction_summary_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    compaction_summary_json: Mapped[str] = mapped_column(Text, default="{}")
    compaction_first_kept_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    compaction_model_id: Mapped[str] = mapped_column(String(256), default="")
    compaction_chars_in: Mapped[int] = mapped_column(Integer, default=0)
    compaction_chars_out: Mapped[int] = mapped_column(Integer, default=0)
    compaction_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class BrokerChatRun(Base):"""
    if needle not in models:
        raise SystemExit("models needle not found")
    models_path.write_text(models.replace(needle, insert, 1), encoding="utf-8")
    print("patched models")
else:
    print("models ok")

# --- broker_chat append_event FTS ---
bc_path = oss / "backend/app/services/broker_chat.py"
bc = bc_path.read_text(encoding="utf-8")
if "index_event" not in bc:
    pat = (
        r"(db\.add\(row\)\n    db\.commit\(\)\n    db\.refresh\(row\)\n)"
        r"(    try:\n        client = redis_connection\(\))"
    )
    repl = (
        r"\1    try:\n"
        r"        from app.agent_harness.session_fts import index_event\n\n"
        r"        index_event(db, row, run)\n"
        r"    except Exception:\n"
        r"        pass\n"
        r"\2"
    )
    bc2, n = re.subn(pat, repl, bc, count=1)
    if n != 1:
        raise SystemExit(f"broker_chat FTS patch failed n={n}")
    bc_path.write_text(bc2, encoding="utf-8")
    print("patched broker_chat FTS")
else:
    print("broker_chat FTS ok")

print("done phase1")
