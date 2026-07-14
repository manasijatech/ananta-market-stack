import json
from datetime import timedelta
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services import desktop_audio
from db.models import DesktopAudioPairing, User
from db.session import Base


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def test_pairing_secret_is_one_time_and_device_token_is_hashed():
    db = _db()
    try:
        db.add(User(id="u1", display_name="User"))
        db.commit()
        pairing = desktop_audio.start_pairing(db, "u1")

        completed = desktop_audio.complete_pairing(
            db,
            pairing_id=pairing["pairing_id"],
            secret=pairing["secret"],
            label="Desk",
            metadata={"platform": "test"},
        )

        assert completed["device_token"]
        device = desktop_audio.authenticate_device(db, completed["device_token"])
        assert device is not None
        assert device.token_hash != completed["device_token"]
        assert json.loads(device.metadata_json)["platform"] == "test"

        try:
            desktop_audio.complete_pairing(
                db,
                pairing_id=pairing["pairing_id"],
                secret=pairing["secret"],
                label="Desk again",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("completed pairing should not be reusable")
    finally:
        db.close()


def test_expired_pairing_cannot_complete():
    db = _db()
    try:
        db.add(User(id="u1", display_name="User"))
        db.commit()
        pairing = desktop_audio.start_pairing(db, "u1")
        row = db.get(DesktopAudioPairing, pairing["pairing_id"])
        row.expires_at = desktop_audio._now() - timedelta(seconds=1)
        db.add(row)
        db.commit()

        try:
            desktop_audio.complete_pairing(
                db,
                pairing_id=pairing["pairing_id"],
                secret=pairing["secret"],
                label="Desk",
            )
        except ValueError as exc:
            assert "expired" in str(exc)
        else:
            raise AssertionError("expired pairing should fail")
    finally:
        db.close()


def test_edge_audio_delivery_creates_cached_mp3(tmp_path, monkeypatch):
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        desktop_audio,
        "_channel_config",
        lambda _channel: {
            "tts_provider": "edge_tts",
            "spoken_template": "{title}. {message}",
            "edge_voice": "en-US-EmmaMultilingualNeural",
            "edge_rate": "0",
            "edge_pitch": "0",
            "edge_volume": "0",
            "retention_days": "15",
        },
    )
    monkeypatch.setattr(desktop_audio, "_target_devices", lambda *_args, **_kwargs: [SimpleNamespace(id="dev-1")])
    monkeypatch.setattr(desktop_audio, "_cached_audio_asset", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        desktop_audio,
        "_generate_edge_audio",
        lambda _config, _text: (b"edge-audio", "en-US-EmmaMultilingualNeural", "+0%", "+0Hz", "+0%"),
    )
    monkeypatch.setattr(desktop_audio, "_storage_dir", lambda: tmp_path)

    def fake_create_assets(_db, **kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(desktop_audio, "_create_assets", fake_create_assets)

    notification = SimpleNamespace(
        user_id="u1",
        id="n1",
        title="Desktop audio channel test",
        message="Edge voice test",
        level="info",
        symbol=None,
        exchange=None,
    )
    delivery = SimpleNamespace(id="d1", payload_json="{}")

    ok, message = desktop_audio.queue_audio_for_delivery(None, notification, delivery, object())

    assert ok is True
    assert message == ""
    assert captured["model_id"] == "edge_tts"
    assert captured["response_format"] == "mp3"
    assert captured["voice"] == "en-US-EmmaMultilingualNeural|pitch=+0Hz|rate=+0%|volume=+0%"
    assert captured["byte_size"] == len(b"edge-audio")


def test_edge_audio_delivery_reuses_cached_asset(tmp_path, monkeypatch):
    existing = tmp_path / "cached.mp3"
    existing.write_bytes(b"cached")
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        desktop_audio,
        "_channel_config",
        lambda _channel: {
            "tts_provider": "edge_tts",
            "spoken_template": "{title}. {message}",
            "edge_voice": "en-US-EmmaMultilingualNeural",
        },
    )
    monkeypatch.setattr(desktop_audio, "_target_devices", lambda *_args, **_kwargs: [SimpleNamespace(id="dev-1")])
    monkeypatch.setattr(
        desktop_audio,
        "_cached_audio_asset",
        lambda *_args, **_kwargs: SimpleNamespace(
            model_id="edge_tts",
            voice="en-US-EmmaMultilingualNeural|pitch=+0Hz|rate=+0%|volume=+0%",
            response_format="mp3",
            file_path=str(existing),
            mime_type="audio/mpeg",
            byte_size=6,
        ),
    )
    monkeypatch.setattr(
        desktop_audio,
        "_generate_edge_audio",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("should not regenerate cached audio")),
    )

    def fake_create_assets(_db, **kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(desktop_audio, "_create_assets", fake_create_assets)

    notification = SimpleNamespace(
        user_id="u1",
        id="n1",
        title="Desktop audio channel test",
        message="Edge voice test",
        level="info",
        symbol=None,
        exchange=None,
    )
    delivery = SimpleNamespace(id="d1", payload_json="{}")

    ok, message = desktop_audio.queue_audio_for_delivery(None, notification, delivery, object())

    assert ok is True
    assert message == ""
    assert captured["file_path"] == str(existing)
    assert captured["byte_size"] == 6


def test_edge_voice_list_is_cached(monkeypatch):
    calls = {"count": 0}

    async def fake_list_voices():
        calls["count"] += 1
        return [
            {
                "Name": "Microsoft Server Speech Text to Speech Voice (en-US, EmmaMultilingualNeural)",
                "ShortName": "en-US-EmmaMultilingualNeural",
                "Locale": "en-US",
                "Gender": "Female",
                "FriendlyName": "Microsoft Emma Online (Natural) - English (United States)",
                "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": ["Friendly"]},
            }
        ]

    monkeypatch.setattr(desktop_audio.edge_tts, "list_voices", fake_list_voices)
    desktop_audio._edge_voice_cache["expires_at"] = None
    desktop_audio._edge_voice_cache["voices"] = []

    first = desktop_audio.list_edge_voices(force_refresh=True)
    second = desktop_audio.list_edge_voices()

    assert calls["count"] == 1
    assert first == second
    assert first[0]["short_name"] == "en-US-EmmaMultilingualNeural"
