"""Normalize explicit provider metadata without inferring capabilities from model names."""

import re

from app.ai.contracts import AIError

MODEL_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$")


def model_catalog(payload):
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or len(rows) > 1000:
        raise AIError("AI_INVALID_RESPONSE")
    models = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise AIError("AI_INVALID_RESPONSE")
        name = row.get("id")
        if not isinstance(name, str) or not MODEL_NAME.fullmatch(name):
            continue
        if name in seen:
            continue
        seen.add(name)
        capabilities = {}
        metadata = row.get("capabilities")
        metadata = metadata if isinstance(metadata, dict) else {}
        for key in ("streaming", "structured_output", "vision", "tool_calling"):
            value = metadata.get(key, row.get(key))
            if type(value) is bool:
                capabilities[key] = value
        for source in (metadata, row):
            for key in (
                "max_context_tokens",
                "context_length",
                "max_context_length",
                "context_window",
                "max_model_len",
            ):
                value = source.get(key)
                if type(value) is int and 256 <= value <= 2_000_000:
                    capabilities["max_context_tokens"] = value
                    break
            if "max_context_tokens" in capabilities:
                break
        models.append({"model_name": name, "capabilities": capabilities})
    if rows and not models:
        raise AIError("AI_INVALID_RESPONSE")
    return models
