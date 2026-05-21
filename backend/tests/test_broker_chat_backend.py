from app.main import app
from app.schemas.broker_chat import BrokerChatPreferenceOut, BrokerChatSubmitIn
from app.services.broker_chat_queue import broker_chat_stream_key


def test_broker_chat_routes_are_registered():
    paths = {getattr(route, "path", "") for route in app.routes}

    assert "/api/v1/broker-chat/config" in paths
    assert "/api/v1/broker-chat/runs" in paths
    assert "/api/v1/broker-chat/runs/{run_id}/stream" in paths
    assert "/api/v1/broker-chat/runs/{run_id}/events" in paths


def test_broker_chat_schemas_and_stream_key_are_stable():
    preference = BrokerChatPreferenceOut()
    request = BrokerChatSubmitIn(message="Show my holdings")

    assert preference.event_visibility == "minimal"
    assert request.message == "Show my holdings"
    assert broker_chat_stream_key("run-1") == "broker-chat:run:run-1:events"
