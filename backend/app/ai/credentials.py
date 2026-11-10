from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from pydantic import SecretStr

from app.errors import AppError


class KeyVault:
    def __init__(self, key: SecretStr):
        self._fernet = Fernet(key.get_secret_value().encode())

    def encrypt(self, value: SecretStr) -> str:
        return self._fernet.encrypt(value.get_secret_value().encode()).decode()

    def decrypt(self, value: str) -> SecretStr:
        try:
            return SecretStr(self._fernet.decrypt(value.encode()).decode())
        except InvalidToken, UnicodeError, ValueError:
            raise AppError("AI_KEY_UNAVAILABLE", "模型密钥不可用，请重新保存密钥", 503) from None


def validate_endpoint(value: str, allowed_origins: str) -> str:
    """Validate a base URL; '*' allows any HTTP(S) origin without redirects."""
    try:
        url = urlsplit(value)
        origin = f"{url.scheme}://{url.netloc}"
        allowed = {item.strip().rstrip("/") for item in allowed_origins.split(",")}
        valid = (
            url.scheme in {"https", "http"}
            and bool(url.hostname)
            and (url.port is None or 1 <= url.port <= 65535)
            and not (url.username or url.password or url.query or url.fragment)
            and ("*" in allowed or origin in allowed)
            and all(
                part.isascii() and part.replace("-", "").replace("_", "").isalnum()
                for part in url.path.split("/")
                if part
            )
            and "//" not in url.path
        )
    except ValueError:
        valid = False
    if not valid:
        raise AppError("AI_ENDPOINT_NOT_ALLOWED", "接口地址无效，请填写有效的 HTTP/HTTPS 接口地址")
    return value.rstrip("/")
