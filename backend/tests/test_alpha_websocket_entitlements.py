from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.alpha_websocket import (
    _credential_for_user,
    _entitled_products,
    live_entitlement_from_account,
)


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


def test_credential_for_user_uses_workspace_config_owner(monkeypatch):
    owner_id = "owner-user"
    member_id = "member-user"
    credential = SimpleNamespace(user_id=owner_id, api_key_cipher="cipher", is_enabled=True)
    db = MagicMock()
    db.get.return_value = credential

    monkeypatch.setattr(
        "app.services.alpha_websocket.rbac.workspace_config_owner_user_id",
        lambda _db, user_id: owner_id if user_id == member_id else user_id,
    )

    resolved = _credential_for_user(db, member_id)

    assert resolved is credential
    db.get.assert_called_once()
    assert db.get.call_args.args[1] == owner_id


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


def test_scale_addon_overrides_stale_zero_live_entitlement():
    account = _account(
        "scale_1000",
        plan_id="scale",
        live_entitlement={"plan_id": "scale", "active_symbol_limit": 0},
    )

    entitlement = live_entitlement_from_account(account)

    assert entitlement["active_symbol_limit"] == 1000
    assert entitlement["monthly_unique_symbol_limit"] == 3000
    assert _entitled_products(account) == [
        "news",
        "announcements",
        "earnings",
        "concalls",
        "alerts",
    ]


def test_scale_metadata_overrides_stale_zero_live_entitlement():
    account = _account(
        "sandbox",
        plan_id="scale",
        live_entitlement={"plan_id": "scale", "active_symbol_limit": 0},
    )
    account["metadata"]["live_active_symbol_limit"] = 1000
    account["metadata"]["live_monthly_unique_symbol_limit"] = 3000

    entitlement = live_entitlement_from_account(account)

    assert entitlement["active_symbol_limit"] == 1000
    assert entitlement["monthly_unique_symbol_limit"] == 3000


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
