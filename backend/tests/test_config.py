from app.config import Settings


def test_settings_accepts_empty_log_to_file_env(monkeypatch):
    monkeypatch.setenv("LOG_TO_FILE", "")

    settings = Settings()

    assert settings.log_to_file is None
