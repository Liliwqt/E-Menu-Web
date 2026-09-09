from pathlib import Path

from touchorders_core.settings import Settings, clear_settings_cache, get_settings


def test_environment_overrides_yaml_defaults(monkeypatch, tmp_path: Path) -> None:
    config_path = tmp_path / "settings.yaml"
    config_path.write_text(
        "environment: test\nlog_level: DEBUG\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("TOUCHORDERS_CONFIG_FILE", str(config_path))
    monkeypatch.setenv("TOUCHORDERS_LOG_LEVEL", "WARNING")
    clear_settings_cache()

    settings = get_settings()

    assert settings.environment == "test"
    assert settings.log_level == "WARNING"  # environment beats the YAML default
    clear_settings_cache()


def test_settings_do_not_read_the_openai_api_key(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-value-not-for-logs")

    settings = Settings()

    assert "openai_api_key" not in Settings.model_fields
    assert "sk-test-value-not-for-logs" not in repr(settings)
