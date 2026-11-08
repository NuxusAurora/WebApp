import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(encoded: str, password: str) -> bool:
    try:
        return hasher.verify(encoded, password)
    except VerificationError:
        return False
