from touchorders_core.observability.logging import redact_secrets


def test_structured_log_processor_scrubs_sensitive_values() -> None:
    result = redact_secrets(
        None,
        "info",
        {
            "event": "gateway failed for sk-secret-value-1234",
            "api_key": "must-not-leak",
            "nested": {"token": "must-not-leak"},
        },
    )

    assert result["event"] == "gateway failed for [REDACTED_OPENAI_KEY]"
    assert result["api_key"] == "[REDACTED]"
    assert result["nested"]["token"] == "[REDACTED]"
