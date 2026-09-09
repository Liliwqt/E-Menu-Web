"""Zero-config Railway defaults: environment autodetection and production CORS tightening."""

from __future__ import annotations

from touchorders_core.settings import DEFAULT_ALLOWED_ORIGINS, FIREBASE_HOSTING_ORIGINS, Settings, clear_settings_cache


def _clear_env(monkeypatch) -> None:
    for name in ("TOUCHORDERS_ENVIRONMENT", "ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "TOUCHORDERS_CORS_ORIGINS", "CORS_ORIGINS"):
        monkeypatch.delenv(name, raising=False)
    clear_settings_cache()


def test_environment_defaults_to_development_off_railway(monkeypatch) -> None:
    _clear_env(monkeypatch)
    assert Settings().environment == "development"


def test_environment_autodetected_from_railway_metadata(monkeypatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    assert Settings().environment == "production"


def test_unknown_railway_environment_treated_as_production(monkeypatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "pr-preview-42")
    assert Settings().environment == "production"


def test_explicit_environment_wins_over_railway(monkeypatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    monkeypatch.setenv("TOUCHORDERS_ENVIRONMENT", "staging")
    assert Settings().environment == "staging"


def test_production_cors_defaults_to_hosting_plus_localhost(monkeypatch) -> None:
    _clear_env(monkeypatch)
    settings = Settings(environment="production")
    origins = settings.cors_origins_list
    # Production Firebase Hosting origins are preserved...
    assert all(o in origins for o in FIREBASE_HOSTING_ORIGINS)
    # ...and the local dev origin is allowed against the deployed backend.
    assert "http://localhost:5173" in origins
    assert origins == list(DEFAULT_ALLOWED_ORIGINS)


def test_explicit_cors_override_is_respected_in_production(monkeypatch) -> None:
    _clear_env(monkeypatch)
    settings = Settings(environment="production", cors_allow_origins="https://ops.example.com")
    assert settings.cors_origins_list == ["https://ops.example.com"]


def test_development_keeps_wildcard_cors(monkeypatch) -> None:
    _clear_env(monkeypatch)
    assert Settings(environment="development").cors_origins_list == ["*"]
