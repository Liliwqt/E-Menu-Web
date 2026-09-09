# TouchOrders Agent Core

The TouchOrders Agent Core is the Python backend for deterministic restaurant operations
monitoring, human-approved workflows, and schema-constrained AI reasoning.

It follows the architectural principle: **a deterministic core with AI at the edges**.
Business calculations, thresholding, workflows, and effects remain deterministic Python.
Future LLM access is centralized in `touchorders_core.llm.gateway`.

## Stage 0: run locally

```bash
cd agent-core
python -m pip install -e '.[dev]'
touchorders-agent-core
```

The liveness endpoint is available at `GET /health`; interactive OpenAPI docs are at `/docs`.

Run the Stage 0 checks:

```bash
pytest
lint-imports
alembic upgrade head
```

`alembic upgrade head` creates only the Alembic version marker at this stage. Domain tables
arrive in Stage 1.
