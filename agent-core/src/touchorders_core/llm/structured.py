"""Pydantic <-> strict OpenAI ``json_schema`` helpers (§14.2).

Strict Structured Outputs require every object to set ``additionalProperties: false`` and list all
of its properties in ``required``. Our domain models already forbid extras; this makes the rest of
the transformation explicit so a model response cannot smuggle unschema'd fields.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


def _strictify(schema: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(schema, dict):
        return schema
    if schema.get("type") == "object" or "properties" in schema:
        schema.setdefault("additionalProperties", False)
        properties = schema.get("properties", {})
        if properties:
            schema["required"] = list(properties.keys())
            for value in properties.values():
                _strictify(value)
    for key in ("items", "additionalProperties"):
        if isinstance(schema.get(key), dict):
            _strictify(schema[key])
    for combinator in ("anyOf", "oneOf", "allOf"):
        for sub in schema.get(combinator, []) or []:
            _strictify(sub)
    for definition in (schema.get("$defs") or {}).values():
        _strictify(definition)
    return schema


def strict_response_format(model: type[BaseModel]) -> dict[str, Any]:
    """Build the ``response_format`` payload for a strict Structured Outputs call."""

    schema = _strictify(model.model_json_schema())
    return {
        "type": "json_schema",
        "json_schema": {"name": model.__name__, "schema": schema, "strict": True},
    }
