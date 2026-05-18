from app.services.alpha_websocket import _entitled_products, live_entitlement_from_account


def _account(tier: str, *, plan_id: str = "pro", live_entitlement: dict | None = None):
    return {
        "metadata": {
            "subscription_plan_id": plan_id,
            "subscription_plan_name": plan_id.title(),
        },
        "websocket_addons": [
            {"product": product, "enabled": True, "tier": tier}
            for product in ["news", "announcements", "earnings", "concalls", "alerts"]
        ],
        **({"live_entitlement": live_entitlement} if live_entitlement is not None else {}),
    }


def test_sandbox_or_zero_symbol_entitlement_has_no_live_products():
    account = _account(
        "sandbox",
        plan_id="sandbox",
        live_entitlement={"plan_id": "sandbox", "active_symbol_limit": 0},
    )

    assert _entitled_products(account) == []


def test_capped_entitlement_enables_configured_live_products():
    account = _account(
        "pro_500",
        live_entitlement={"plan_id": "pro", "active_symbol_limit": 500},
    )

    assert _entitled_products(account) == [
        "news",
        "announcements",
        "earnings",
        "concalls",
        "alerts",
    ]


def test_full_market_entitlement_is_read_from_alpha_account_summary():
    account = _account(
        "full_market",
        plan_id="full_market",
        live_entitlement={
            "plan_id": "full_market",
            "active_symbol_limit": None,
            "full_market_products": ["news", "alerts"],
        },
    )

    entitlement = live_entitlement_from_account(account)

    assert entitlement["plan_id"] == "full_market"
    assert entitlement["full_market_products"] == ["news", "alerts"]
