import base64
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)

    database_url: SecretStr
    redis_url: SecretStr
    celery_broker_url: SecretStr
    celery_result_backend: SecretStr
    secret_key: SecretStr
    encryption_key: SecretStr
    storage_endpoint: str
    storage_access_key: SecretStr
    storage_secret_key: SecretStr
    storage_region: str = "us-east-1"
    storage_bucket: str = "learning-dev"
    dependency_timeout: float = Field(default=1.5, ge=0.05, le=10)
    cookie_secure: bool = False
    public_origin: str = "http://localhost:3000"
    storage_public_endpoint: str = "http://127.0.0.1:9000"
    mail_outbox: str = "/tmp/learning-outbox"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    mail_from: str = "learning@localhost"

    @field_validator("database_url")
    @classmethod
    def database_driver(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
            valid = url.drivername == "postgresql+psycopg" and bool(url.host and url.database)
        except Exception:
            valid = False
        if not valid:
            raise ValueError("DATABASE_URL must use postgresql+psycopg with host and database")
        return value

    @field_validator("redis_url", "celery_broker_url", "celery_result_backend")
    @classmethod
    def redis_scheme(cls, value: SecretStr) -> SecretStr:
        try:
            url = urlsplit(value.get_secret_value())
            valid = (
                url.scheme in {"redis", "rediss"}
                and bool(url.hostname)
                and (url.port is None or 1 <= url.port <= 65535)
                and (url.path in {"", "/"} or url.path[1:].isascii() and url.path[1:].isdigit())
            )
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("Redis settings require a redis/rediss URL with host")
        return value

    @field_validator("secret_key", "storage_secret_key")
    @classmethod
    def secret_length(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("Secret must contain at least 32 characters")
        return value

    @field_validator("encryption_key")
    @classmethod
    def encryption_format(cls, value: SecretStr) -> SecretStr:
        try:
            decoded = base64.b64decode(value.get_secret_value(), altchars=b"-_", validate=True)
        except ValueError, TypeError:
            decoded = b""
        if len(decoded) != 32:
            raise ValueError("ENCRYPTION_KEY must encode 32 bytes in URL-safe base64")
        return value

    @field_validator("storage_endpoint")
    @classmethod
    def storage_url(cls, value: str) -> str:
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
            raise ValueError("STORAGE_ENDPOINT must be an HTTP(S) URL without credentials")
        return value
