import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.errors import AppError
from app.main import create_app
from app.models import AuthToken, Base, User, now
from app.storage import inspect_text

HEADERS = {"X-Requested-With": "structured-learning"}
PASSWORD = "example-password-123"


def test_test_login_requires_explicit_local_configuration(account_app):
    app, client = account_app
    assert client.post("/api/v1/auth/test-login").status_code == 404
    app.state.settings.test_login_enabled = True
    app.state.settings.public_origin = "https://learning.example.com"
    assert client.post("/api/v1/auth/test-login").status_code == 404


@pytest.mark.parametrize(
    "enabled,origin,allowed,secure",
    [
        (True, "https://learning.example.com", "", True),
        (True, "https://learning.example.com", "https://other.example.com", True),
        (True, "https://learning.example.com", "https://learning.example.com", False),
        (True, "http://learning.example.com", "http://learning.example.com", True),
        (False, "https://learning.example.com", "https://learning.example.com", True),
    ],
)
def test_public_test_login_requires_all_explicit_gates(
    account_app, enabled, origin, allowed, secure
):
    app, client = account_app
    app.state.settings.test_login_enabled = enabled
    app.state.settings.public_origin = origin
    app.state.settings.test_login_public_origin = allowed
    app.state.settings.cookie_secure = secure
    assert client.post("/api/v1/auth/test-login").status_code == 404


def test_public_test_login_keeps_the_reusable_normal_account_and_secure_session(account_app):
    app, client = account_app
    app.state.settings.test_login_enabled = True
    app.state.settings.public_origin = "https://learning.example.com"
    app.state.settings.test_login_public_origin = "https://learning.example.com"
    app.state.settings.cookie_secure = True
    first = client.post("/api/v1/auth/test-login", json={"role": "admin"})
    assert first.status_code == 200
    actor = first.json()["data"]
    assert actor["role"] == "user" and actor["email_verified"]
    assert "Secure" in first.headers["set-cookie"]
    assert "HttpOnly" in first.headers["set-cookie"]
    assert "SameSite=strict" in first.headers["set-cookie"]
    assert client.post("/api/v1/auth/test-login").json()["data"]["id"] == actor["id"]


def test_test_login_uses_an_isolated_reusable_normal_session(account_app):
    app, client = account_app
    authenticate(client, app)
    original_id = client.get("/api/v1/users/me").json()["data"]["id"]
    client.post("/api/v1/courses", json={"title": "原账户课程"})
    client.post("/api/v1/auth/logout")
    app.state.settings.test_login_enabled = True
    response = client.post(
        "/api/v1/auth/test-login", json={"email": "one@example.com", "role": "admin"}
    )
    assert response.status_code == 200
    actor = response.json()["data"]
    assert actor["id"] != original_id
    assert actor["role"] == "user" and actor["email_verified"]
    assert actor["email"] == "local-test@example.com"
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    assert client.get("/api/v1/courses").json()["data"] == []
    assert client.post("/api/v1/courses", json={"title": "测试账户课程"}).status_code == 201
    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/users/me").status_code == 401
    repeated = client.post("/api/v1/auth/test-login")
    assert repeated.json()["data"]["id"] == actor["id"]
    assert len(client.get("/api/v1/courses").json()["data"]) == 1


def test_test_login_does_not_take_over_an_existing_email(account_app):
    app, client = account_app
    register(client, app, "local-test@example.com")
    app.state.settings.test_login_enabled = True
    response = client.post("/api/v1/auth/test-login")
    assert response.status_code == 409
    assert "set-cookie" not in response.headers
    assert client.get("/api/v1/users/me").status_code == 401


def test_test_login_uses_the_rate_limiter(account_app):
    app, client = account_app
    app.state.settings.test_login_enabled = True

    class Blocked:
        async def eval(self, *args):
            return 11

    app.state.resources.redis = Blocked()
    assert client.post("/api/v1/auth/test-login").status_code == 429


class MemoryMail:
    def __init__(self, settings):
        self.sent = []

    def send(self, email, kind, token):
        self.sent.append((email, kind, token))


class MemoryStore:
    def __init__(self, settings):
        self.objects = {}
        self.fail = False

    def put(self, key, content):
        self.objects[key] = content

    def delete(self, key):
        if self.fail:
            raise RuntimeError("private-storage-error")
        self.objects.pop(key, None)

    def download(self, key):
        return f"https://storage.example/{key}?signature=opaque"

    def close(self):
        pass


class Limiter:
    async def eval(self, *args):
        return 1


@pytest.fixture
def account_app(configured, tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")

    @event.listens_for(engine.sync_engine, "connect")
    def foreign_keys(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    async def init():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init())

    class Resources:
        def __init__(self, settings):
            self.sessions = async_sessionmaker(engine, expire_on_commit=False)
            self.redis = Limiter()

        @asynccontextmanager
        async def session(self):
            async with self.sessions() as db:
                yield db

        async def close(self):
            await engine.dispose()

    app = create_app(configured, Resources, MemoryMail, MemoryStore)
    with TestClient(app, headers=HEADERS) as client:
        yield app, client


def register(client, app, email="one@example.com"):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": PASSWORD,
            "display_name": "学生",
        },
    )
    assert response.status_code == 201, response.text
    token = app.state.mailer.sent[-1][2]
    assert token not in response.text
    return token


def authenticate(client, app, email="one@example.com"):
    token = register(client, app, email)
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 200
    response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"]
    return client.cookies.get("learning_session")


def test_verification_replay_session_logout_and_no_secret(account_app):
    app, client = account_app
    token = register(client, app)
    credentials = {"email": "one@example.com", "password": PASSWORD}
    assert client.post("/api/v1/auth/login", json=credentials).status_code == 403
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 400
    assert client.post("/api/v1/auth/login", json=credentials).status_code == 200
    cookie = client.cookies.get("learning_session")
    me = client.get("/api/v1/users/me")
    assert me.status_code == 200
    assert "hash" not in me.text and cookie not in me.text
    assert client.post("/api/v1/auth/logout").status_code == 200
    client.cookies.set("learning_session", cookie)
    assert client.get("/api/v1/users/me").status_code == 401


def test_two_users_all_course_and_upload_boundaries(account_app):
    app, client = account_app
    first = authenticate(client, app)
    response = client.post("/api/v1/courses", json={"title": "高数", "subject": "数学"})
    assert response.status_code == 201
    course = response.json()["data"]
    path = f"/api/v1/courses/{course['id']}"
    file = client.post(
        path + "/uploads", content="学习资料".encode(), headers={"X-Filename": "notes.txt"}
    )
    assert file.status_code == 201
    file_path = path + f"/uploads/{file.json()['data']['id']}"
    assert client.get(file_path + "/download").json()["data"]["expires_in"] == 60
    authenticate(client, app, "two@example.com")
    assert client.get("/api/v1/courses").json()["data"] == []
    for method, suffix, data in [
        ("GET", "", None),
        ("PATCH", "", {"title": "stolen"}),
        ("DELETE", "", None),
        ("GET", "/uploads", None),
        ("GET", file_path[len(path) :] + "/download", None),
        ("DELETE", file_path[len(path) :], None),
    ]:
        assert client.request(method, path + suffix, json=data).status_code == 404
    assert (
        client.post(
            path + "/uploads", content=b"stolen", headers={"X-Filename": "stolen.txt"}
        ).status_code
        == 404
    )
    client.cookies.set("learning_session", first)
    assert client.patch(path, json={"title": "高数 II"}).status_code == 200
    assert client.get(path).json()["data"]["title"] == "高数 II"
    assert (
        client.post("/api/v1/courses", json={"title": "x", "user_id": "hacked"}).status_code == 422
    )
    app.state.store.fail = True
    assert client.delete(path).status_code == 500
    assert client.get(path).status_code == 200
    app.state.store.fail = False
    assert client.delete(path).status_code == 200
    assert app.state.store.objects == {}
    assert client.get(file_path + "/download").status_code == 404


def test_reset_revokes_all_sessions_and_tokens(account_app):
    app, client = account_app
    cookie = authenticate(client, app)
    assert (
        client.post("/api/v1/auth/forgot-password", json={"email": "one@example.com"}).status_code
        == 200
    )
    token = app.state.mailer.sent[-1][2]
    body = {"token": token, "password": "new-example-password"}
    assert client.post("/api/v1/auth/reset-password", json=body).status_code == 200
    assert client.post("/api/v1/auth/reset-password", json=body).status_code == 400
    client.cookies.set("learning_session", cookie)
    assert client.get("/api/v1/users/me").status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": "one@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )


def test_expiry_csrf_validation_rate_limit(account_app):
    app, client = account_app
    token = register(client, app)

    async def expire():
        async with app.state.resources.session() as db:
            await db.execute(update(AuthToken).values(expires_at=now() - timedelta(seconds=1)))
            await db.commit()

    client.portal.call(expire)
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 400
    assert (
        client.post(
            "/api/v1/auth/login", headers={"Origin": "https://evil.example"}, json={}
        ).status_code
        == 403
    )
    invalid = client.post("/api/v1/auth/login", json={"email": "bad", "password": "SECRET"})
    assert invalid.status_code == 422 and "SECRET" not in invalid.text

    class Blocked:
        async def eval(self, *args):
            return 11

    app.state.resources.redis = Blocked()
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": "one@example.com", "password": PASSWORD}
        ).status_code
        == 429
    )


def test_upload_constraints_and_commit_compensation(account_app, monkeypatch):
    app, client = account_app
    authenticate(client, app)
    course = client.post("/api/v1/courses", json={"title": "数学"}).json()["data"]["id"]
    path = f"/api/v1/courses/{course}/uploads"
    for name, content, expected in [
        ("x.pdf", b"%PDF", 400),
        ("../x.txt", b"hello", 400),
        ("x.txt", b"\x00", 400),
        ("x.txt", b"<script>x", 400),
        ("x.txt", b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE", 400),
        ("x.txt", b"a" * (1024 * 1024 + 1), 413),
    ]:
        assert (
            client.post(path, content=content, headers={"X-Filename": name}).status_code == expected
        )
    from sqlalchemy.ext.asyncio import AsyncSession

    original = AsyncSession.commit

    async def fail_commit(self):
        raise RuntimeError("private-database-error")

    monkeypatch.setattr(AsyncSession, "commit", fail_commit)
    assert (
        client.post(path, content=b"safe", headers={"X-Filename": "notes.txt"}).status_code == 500
    )
    assert app.state.store.objects == {}
    monkeypatch.setattr(AsyncSession, "commit", original)


def test_upload_text_policy():
    inspect_text("notes.txt", "纯文本\n学科资料".encode())
    with pytest.raises(AppError):
        inspect_text("notes.txt", b"\xff")


def test_password_and_mail_not_in_logs(account_app, caplog):
    app, client = account_app
    token = register(client, app)
    assert PASSWORD not in caplog.text and token not in caplog.text

    async def check():
        async with app.state.resources.session() as db:
            row = await db.scalar(select(AuthToken))
            assert row.digest != token and len(row.digest) == 64

    client.portal.call(check)


def test_profile_password_change_and_body_limit(account_app):
    app, client = account_app
    cookie = authenticate(client, app)
    assert (
        client.patch("/api/v1/users/me", json={"display_name": "新名字"}).json()["data"][
            "display_name"
        ]
        == "新名字"
    )
    assert client.patch("/api/v1/users/me", json={"role": "admin"}).status_code == 422
    body = {"current_password": PASSWORD, "password": "a-new-secure-password"}
    assert client.post("/api/v1/auth/change-password", json=body).status_code == 200
    client.cookies.set("learning_session", cookie)
    assert client.get("/api/v1/users/me").status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": "one@example.com", "password": body["password"]}
        ).status_code
        == 200
    )
    assert client.post("/api/v1/courses", content=b"a" * 32769).status_code == 413


def test_mail_failure_rolls_back_registration(account_app, monkeypatch):
    app, client = account_app

    def fail(*args):
        raise RuntimeError("private-smtp-credentials")

    monkeypatch.setattr(app.state.mailer, "send", fail)
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "fail@example.com", "password": PASSWORD, "display_name": "失败测试"},
    )
    assert response.status_code == 500 and "private-smtp" not in response.text

    async def check():
        async with app.state.resources.session() as db:
            assert await db.scalar(select(User).where(User.email == "fail@example.com")) is None

    client.portal.call(check)


def test_admin_cannot_bypass_private_course_and_expired_session(account_app):
    app, client = account_app
    authenticate(client, app)
    course = client.post("/api/v1/courses", json={"title": "私人课程"}).json()["data"]["id"]
    authenticate(client, app, "admin@example.com")

    async def elevate():
        async with app.state.resources.session() as db:
            await db.execute(
                update(User).where(User.email == "admin@example.com").values(role="admin")
            )
            await db.commit()

    client.portal.call(elevate)
    assert client.get("/api/v1/users/me").json()["data"]["role"] == "admin"
    assert client.get(f"/api/v1/courses/{course}").status_code == 404

    async def expire():
        async with app.state.resources.session() as db:
            await db.execute(
                update(AuthToken)
                .where(AuthToken.kind == "session")
                .values(expires_at=now() - timedelta(seconds=1))
            )
            await db.commit()

    client.portal.call(expire)
    assert client.get("/api/v1/users/me").status_code == 401


def test_development_mailbox_and_smtp_transport(configured, tmp_path, monkeypatch):
    import json
    from unittest.mock import MagicMock

    from app.mail import Mailer

    settings = configured.model_copy(update={"mail_outbox": str(tmp_path / "outbox")})
    Mailer(settings).send("test@example.com", "verify", "opaque-test-token")
    content = json.loads(next((tmp_path / "outbox").glob("*.json")).read_text())
    assert content == {"to": "test@example.com", "kind": "verify", "token": "opaque-test-token"}
    smtp = MagicMock()
    monkeypatch.setattr("app.mail.smtplib.SMTP", smtp)
    settings = settings.model_copy(update={"smtp_host": "mail.example.com"})
    Mailer(settings).send("test@example.com", "reset", "another-test-token")
    connection = smtp.return_value.__enter__.return_value
    connection.starttls.assert_called_once()
    connection.send_message.assert_called_once()


def test_public_mail_without_smtp_fails_instead_of_claiming_delivery(configured, tmp_path):
    from app.errors import AppError
    from app.mail import Mailer

    settings = configured.model_copy(
        update={
            "public_origin": "https://learn.example.com",
            "mail_outbox": str(tmp_path / "outbox"),
        }
    )
    with pytest.raises(AppError) as error:
        Mailer(settings).send("test@example.com", "verify", "test-token")
    assert error.value.status_code == 503
    assert not (tmp_path / "outbox").exists()
