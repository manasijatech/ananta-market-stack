from app.agent_harness.extensions_host import extra_tools


def test_oss_extensions_are_always_a_noop():
    assert extra_tools(object()) == []
