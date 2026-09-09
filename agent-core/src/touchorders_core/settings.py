"""Runtime configuration loaded from environment and an optional YAML file."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import AliasChoices, Field, SecretStr, ValidationError, model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config" / "settings.yaml"

# The Firebase project this repository deploys with (.firebaserc). Used only to derive safe
# production CORS defaults so a Railway deploy needs zero CORS configuration; override with
# TOUCHORDERS_CORS_ORIGINS for custom domains.
FIREBASE_PROJECT_ID = "device-streaming-ded679cd"
# The production frontend is served from this custom domain.
PRODUCTION_FRONTEND_ORIGINS = ("https://touch-menu-web.online",)
FIREBASE_HOSTING_ORIGINS = (
    f"https://{FIREBASE_PROJECT_ID}.web.app",
    f"https://{FIREBASE_PROJECT_ID}.firebaseapp.com",
)
# Local Vite dev server, so a developer can call the deployed backend during development.
DEVELOPMENT_ORIGINS = ("http://localhost:5173",)
# Default allow-list applied when TOUCHORDERS_CORS_ORIGINS is unset: the production custom domain,
# the Firebase Hosting origins, and the local dev origin. An explicit TOUCHORDERS_CORS_ORIGINS
# still overrides entirely.
DEFAULT_ALLOWED_ORIGINS = PRODUCTION_FRONTEND_ORIGINS + FIREBASE_HOSTING_ORIGINS + DEVELOPMENT_ORIGINS


def _detect_environment() -> str:
    """Default the environment from Railway's injected metadata when unset.

    Railway injects RAILWAY_ENVIRONMENT_NAME (and legacy RAILWAY_ENVIRONMENT) into every deploy,
    so TOUCHORDERS_ENVIRONMENT never needs to be set manually there. Any unrecognized Railway
    environment name is treated as production — the fail-safe direction (strict validation on).
    Outside Railway the default remains development.
    """

    railway_name = os.environ.get("RAILWAY_ENVIRONMENT_NAME") or os.environ.get("RAILWAY_ENVIRONMENT")
    if railway_name:
        normalized = railway_name.strip().lower()
        return normalized if normalized in {"development", "test", "staging", "production"} else "production"
    if os.environ.get("RAILWAY_PROJECT_ID"):
        return "production"
    return "development"


class SettingsConfigurationError(RuntimeError):
    """Raised when an optional settings YAML file cannot be used safely."""


class YamlSettingsSource(PydanticBaseSettingsSource):
    """Load non-secret defaults from the configured YAML file.

    This source has lower precedence than initialization arguments, environment variables, and
    `.env`, so deployment secrets and explicit overrides always win.
    """

    def __init__(self, settings_cls: type[BaseSettings]) -> None:
        super().__init__(settings_cls)
        config_path = os.environ.get("TOUCHORDERS_CONFIG_FILE")
        self._path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH

    def get_field_value(
        self,
        field: Any,
        field_name: str,
    ) -> tuple[Any, str, bool]:
        return None, field_name, False

    def __call__(self) -> dict[str, Any]:
        if not self._path.exists():
            return {}

        try:
            parsed = yaml.safe_load(self._path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            raise SettingsConfigurationError(
                f"Unable to load configuration file {self._path}: {exc}"
            ) from exc

        if parsed is None:
            return {}
        if not isinstance(parsed, dict):
            raise SettingsConfigurationError(
                f"Configuration file {self._path} must contain a YAML mapping."
            )
        return parsed


class Settings(BaseSettings):
    """Process-wide runtime settings.

    OpenAI credentials are deliberately not a setting: the architecture requires
    ``llm.gateway`` to be their sole reader in Stage 7. The Stage 0 process can therefore run
    its liveness endpoint with no external credentials.
    """

    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    environment: Literal["development", "test", "staging", "production"] = Field(
        default_factory=_detect_environment,
        validation_alias=AliasChoices("TOUCHORDERS_ENVIRONMENT", "ENVIRONMENT"),
    )
    service_name: str = Field(default="touchorders-agent-core")
    log_level: str = Field(
        default="INFO",
        validation_alias=AliasChoices("TOUCHORDERS_LOG_LEVEL", "LOG_LEVEL"),
    )
    log_json: bool = Field(
        default=True,
        validation_alias=AliasChoices("TOUCHORDERS_LOG_JSON", "LOG_JSON"),
    )
    firebase_service_account_json: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "FIREBASE_SERVICE_ACCOUNT_JSON",
            "TOUCHORDERS_FIREBASE_SERVICE_ACCOUNT_JSON",
        ),
    )
    firebase_credentials_path: Path | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "FIREBASE_CREDENTIALS_PATH", "TOUCHORDERS_FIREBASE_CREDENTIALS_PATH"
        ),
    )
    cors_allow_origins: str = Field(
        default="*",
        validation_alias=AliasChoices("TOUCHORDERS_CORS_ORIGINS", "CORS_ORIGINS"),
        description="Comma-separated allowed origins for the Firebase Hosting frontend / tablet; '*' in dev.",
    )

    @model_validator(mode="after")
    def default_production_cors_to_hosting_origins(self) -> "Settings":
        """In production/staging, an unset ('*') CORS policy tightens to this project's Firebase
        Hosting origins automatically — no manual Railway variable needed. Explicit values and
        development wildcard behavior are untouched."""

        if self.environment in ("production", "staging") and self.cors_allow_origins.strip() in ("", "*"):
            self.cors_allow_origins = ",".join(DEFAULT_ALLOWED_ORIGINS)
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        raw = self.cors_allow_origins.strip()
        if raw == "*" or not raw:
            return ["*"]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            dotenv_settings,
            file_secret_settings,
            YamlSettingsSource(settings_cls),
        )

    @property
    def is_production(self) -> bool:
        """Whether this process is running in the production environment."""

        return self.environment == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the validated, process-wide settings instance."""

    try:
        return Settings()
    except ValidationError as exc:
        raise SettingsConfigurationError(f"Invalid runtime configuration: {exc}") from exc


def clear_settings_cache() -> None:
    """Clear cached settings for tests and controlled process reconfiguration."""

    get_settings.cache_clear()
