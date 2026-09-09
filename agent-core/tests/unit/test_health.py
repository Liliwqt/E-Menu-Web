from fastapi.testclient import TestClient

from touchorders_core.api.app import create_app
from touchorders_core.settings import Settings


def test_health_is_available_without_external_credentials() -> None:
    app = create_app(Settings(environment="test", log_json=False))

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "touchorders-agent-core",
        "version": "0.1.0",
        "environment": "test",
    }
