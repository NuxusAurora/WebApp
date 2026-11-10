from urllib.parse import urlsplit

from app.errors import AppError

DEFAULT_MODEL = "Aurora-Zyron"


def required_model_name(base_url: str) -> str | None:
    """Identify the built-in service by its canonical endpoint, never its display name."""
    try:
        url = urlsplit(base_url)
        if (
            url.scheme == "https"
            and url.hostname == "api.nuxusaurora.com"
            and url.port in {None, 443}
            and url.path.rstrip("/") == "/v1"
            and not (url.username or url.password or url.query or url.fragment)
        ):
            return DEFAULT_MODEL
    except ValueError:
        pass
    return None


def validate_model_name(base_url: str, model_name: str) -> None:
    required = required_model_name(base_url)
    if required and model_name != required:
        raise AppError("AI_MODEL_RESTRICTED", f"默认连接仅支持 {required}")
