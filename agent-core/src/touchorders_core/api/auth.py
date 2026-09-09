"""Identity verification for the BFF (§13.4).

The frontend/tablet authenticate with Firebase; FastAPI is the sole verifier of Firebase ID tokens.
The Admin SDK is imported lazily (like the OpenAI client) so the package — and the tests — do not
require firebase-admin to be installed; only constructing the real verifier touches it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class IdentityError(Exception):
    """The presented token is missing, invalid, or expired."""


@dataclass(frozen=True)
class VerifiedIdentity:
    uid: str
    email: str | None = None


class IdentityVerifier(Protocol):
    def verify(self, id_token: str) -> VerifiedIdentity: ...


class FakeIdentityVerifier:
    """Test/double verifier: accepts registered tokens, rejects everything else."""

    def __init__(self, valid_tokens: dict[str, VerifiedIdentity] | None = None) -> None:
        self._valid = valid_tokens or {"test-id-token": VerifiedIdentity(uid="user-1", email="manager@touchorders.test")}

    def verify(self, id_token: str) -> VerifiedIdentity:
        identity = self._valid.get(id_token)
        if identity is None:
            raise IdentityError("invalid id token")
        return identity


class FirebaseIdentityVerifier:
    """Production verifier: validates Firebase ID tokens via the Admin SDK.

    Initialized once at the composition root with the least-privileged service-account credential
    from the Railway environment (``FIREBASE_SERVICE_ACCOUNT_JSON``).
    """

    def __init__(self, service_account_json: str | None = None) -> None:
        try:
            import firebase_admin
            from firebase_admin import credentials
        except ModuleNotFoundError as exc:  # pragma: no cover - only when Firebase auth is enabled
            raise RuntimeError("firebase-admin is required for Firebase identity verification.") from exc
        if not firebase_admin._apps:
            if service_account_json:
                import json

                firebase_admin.initialize_app(credentials.Certificate(json.loads(service_account_json)))
            else:
                firebase_admin.initialize_app()

    def verify(self, id_token: str) -> VerifiedIdentity:  # pragma: no cover - network/SDK path
        from firebase_admin import auth

        try:
            decoded = auth.verify_id_token(id_token)
        except Exception as exc:  # noqa: BLE001 - normalize any SDK error to IdentityError
            raise IdentityError(str(exc)) from exc
        return VerifiedIdentity(uid=decoded["uid"], email=decoded.get("email"))
