"""Guard the one-module OpenAI import rule before the gateway is implemented."""

from __future__ import annotations

import ast
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[2] / "src" / "touchorders_core"
GATEWAY_PATH = PACKAGE_ROOT / "llm" / "gateway.py"


def _openai_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.extend(alias.name for alias in node.names if alias.name == "openai")
        elif isinstance(node, ast.ImportFrom) and node.module == "openai":
            imported.append(node.module)
    return imported


def test_only_llm_gateway_may_import_openai() -> None:
    offenders = [
        path
        for path in PACKAGE_ROOT.rglob("*.py")
        if path != GATEWAY_PATH and _openai_imports(path)
    ]

    assert offenders == []
