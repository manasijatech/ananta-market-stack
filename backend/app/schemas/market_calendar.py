from __future__ import annotations

from pydantic import BaseModel, Field


class MarketStatusOut(BaseModel):
    """Exchange session phase, holiday status and next open."""

    exchange: str = Field(default="NSE", description="Exchange the status describes.")
    segment: str = Field(default="cash", description="cash, equity_derivatives, currency, or commodity.")
    status: str = Field(
        default="closed",
        description="open, pre_open, closed, holiday, or weekend.",
    )
    phase: str = Field(
        default="closed",
        description=(
            "pre_market, preopen_*, continuous, closing_eligibility_unverified, cas_*, post_close, "
            "closed, holiday, weekend, or special_session_*."
        ),
    )
    holiday_name: str | None = Field(default=None, description="Holiday label when the exchange is shut for one.")
    ist_now: str = Field(default="", description="Server clock in IST as an ISO timestamp.")
    trading_date: str = Field(default="", description="IST date the phase describes.")
    is_trading_day: bool = Field(default=True, description="False on weekends and verified holidays.")
    last_completed_session: str = Field(
        default="",
        description="ISO date of the most recent session whose closing data is official.",
    )
    next_open: str | None = Field(default=None, description="ISO IST timestamp of the next continuous-session open.")
    live_quotes_expected: bool = Field(
        default=False,
        description="True only while the last traded price is a real tick, not an indicative or stale one.",
    )
    calendar_coverage: str = Field(
        default="weekday_only_unverified_holidays",
        description=(
            "verified_seed_<year>, verified_refresh_<year>, operator_verified_override, "
            "operator_override_unverified, caller_supplied, or weekday_only_unverified_holidays."
        ),
    )
    label: str = Field(
        default="Closed",
        description='Human-readable summary, for example "NSE closed · holiday: Diwali-Balipratipada · opens 11 Nov 09:15 IST".',
    )
