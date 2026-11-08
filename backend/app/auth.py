from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.errors import AppError, ok
from app.models import AuthToken, User, now
from app.security import digest, hash_password, new_token, verify_password

router = APIRouter(prefix="/api/v1")
COOKIE = "learning_session"


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class Credentials(Input):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class Registration(Credentials):
    display_name: str = Field(min_length=1, max_length=80, pattern=r"\S")


class TokenInput(Input):
    token: str = Field(min_length=32, max_length=100)


class ResetInput(TokenInput):
    password: str = Field(min_length=12, max_length=128)


class EmailInput(Input):
    email: EmailStr


class ProfileInput(Input):
    display_name: str = Field(min_length=1, max_length=80, pattern=r"\S")


class PasswordInput(Input):
    current_password: str = Field(min_length=12, max_length=128)
    password: str = Field(min_length=12, max_length=128)


async def session(request: Request):
    async with request.app.state.resources.session() as db:
        yield db


DB = Annotated[AsyncSession, Depends(session)]


async def current_user(request: Request, db: DB) -> User:
    token = request.cookies.get(COOKIE, "")
    user = (
        await db.scalar(
            select(User)
            .join(AuthToken)
            .where(
                AuthToken.digest == digest(token),
                AuthToken.kind == "session",
                AuthToken.expires_at > now(),
                User.email_verified.is_(True),
            )
        )
        if token
        else None
    )
    if not user:
        raise AppError("UNAUTHENTICATED", "请先登录", 401)
    return user


Actor = Annotated[User, Depends(current_user)]


def public_user(user):
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "email_verified": user.email_verified,
        "role": user.role,
    }


async def limit(request: Request, action: str, identity: str):
    # Never store raw email/IP in limiter keys. Atomic TTL avoids unbounded keys on cancellation.
    key = f"auth-limit:{action}:{digest(identity)}"
    count = await request.app.state.resources.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then "
        "redis.call('EXPIRE',KEYS[1],600) end; return n",
        1,
        key,
    )
    if count > 10:
        raise AppError("RATE_LIMITED", "尝试过于频繁，请稍后重试", 429)


async def issue(db, user, kind, minutes=30):
    token = new_token()
    db.add(
        AuthToken(
            user_id=user.id,
            digest=digest(token),
            kind=kind,
            expires_at=now() + timedelta(minutes=minutes),
        )
    )
    return token


async def mail_token(request, db, user, kind):
    await db.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.kind == kind))
    token = await issue(db, user, kind)
    await run_in_threadpool(request.app.state.mailer.send, user.email, kind, token)


@router.post("/auth/register", status_code=201)
async def register(body: Registration, request: Request, db: DB):
    await limit(request, "register", request.client.host)
    email = str(body.email).lower()
    if await db.scalar(select(User).where(User.email == email)):
        raise AppError("EMAIL_EXISTS", "此邮箱已注册，请登录或重置密码", 409)
    user = User(
        email=email,
        display_name=body.display_name.strip(),
        password_hash=await run_in_threadpool(hash_password, body.password),
    )
    db.add(user)
    try:
        await db.flush()
        await mail_token(request, db, user, "verify")
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError("EMAIL_EXISTS", "此邮箱已注册", 409) from None
    return ok({"message": "验证邮件已发送，请输入邮件中的验证码"})


async def consume(db, token, kind):
    candidate = await db.scalar(
        select(AuthToken.user_id).where(
            AuthToken.digest == digest(token), AuthToken.kind == kind, AuthToken.expires_at > now()
        )
    )
    if not candidate:
        raise AppError("INVALID_TOKEN", "验证码无效或已过期")
    user = await db.scalar(select(User).where(User.id == candidate).with_for_update())
    # DELETE RETURNING ensures one-use semantics under concurrent requests.
    user_id = await db.scalar(
        delete(AuthToken)
        .where(
            AuthToken.digest == digest(token),
            AuthToken.kind == kind,
            AuthToken.expires_at > now(),
        )
        .returning(AuthToken.user_id)
    )
    if not user_id:
        raise AppError("INVALID_TOKEN", "验证码无效或已过期")
    return user


@router.post("/auth/verify-email")
async def verify_email(body: TokenInput, db: DB):
    user = await consume(db, body.token, "verify")
    user.email_verified = True
    await db.commit()
    return ok({"message": "邮箱已验证，可以登录"})


@router.post("/auth/resend-verification")
async def resend(body: EmailInput, request: Request, db: DB):
    await limit(request, "mail", str(body.email).lower())
    user = await db.scalar(
        select(User).where(User.email == str(body.email).lower()).with_for_update()
    )
    if user and not user.email_verified:
        await mail_token(request, db, user, "verify")
        await db.commit()
    return ok({"message": "若账户需要验证，邮件将发送至该邮箱"})


@router.post("/auth/login")
async def login(body: Credentials, request: Request, response: Response, db: DB):
    await limit(request, "login", str(body.email).lower())
    await limit(request, "login-ip", request.client.host)
    user = await db.scalar(
        select(User).where(User.email == str(body.email).lower()).with_for_update()
    )
    if not user:
        # Equal work for unknown accounts without retaining a global password hash.
        await run_in_threadpool(hash_password, body.password)
        raise AppError("INVALID_CREDENTIALS", "邮箱或密码错误", 401)
    if not await run_in_threadpool(verify_password, user.password_hash, body.password):
        raise AppError("INVALID_CREDENTIALS", "邮箱或密码错误", 401)
    if not user.email_verified:
        raise AppError("EMAIL_NOT_VERIFIED", "请先验证邮箱", 403)
    await db.execute(
        delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.expires_at <= now())
    )
    token = await issue(db, user, "session", 720)
    await db.commit()
    response.set_cookie(
        COOKIE,
        token,
        max_age=43200,
        httponly=True,
        samesite="strict",
        secure=request.app.state.settings.cookie_secure,
    )
    return ok(public_user(user))


@router.post("/auth/logout")
async def logout(request: Request, response: Response, db: DB):
    await db.execute(
        delete(AuthToken).where(
            AuthToken.digest == digest(request.cookies.get(COOKIE, "")), AuthToken.kind == "session"
        )
    )
    await db.commit()
    response.delete_cookie(COOKIE)
    return ok()


@router.post("/auth/forgot-password")
async def forgot(body: EmailInput, request: Request, db: DB):
    await limit(request, "mail", str(body.email).lower())
    user = await db.scalar(
        select(User).where(User.email == str(body.email).lower()).with_for_update()
    )
    if user:
        await mail_token(request, db, user, "reset")
        await db.commit()
    return ok({"message": "若账户存在，重置邮件将发送至该邮箱"})


@router.post("/auth/reset-password")
async def reset(body: ResetInput, db: DB):
    user = await consume(db, body.token, "reset")
    user.password_hash = await run_in_threadpool(hash_password, body.password)
    await db.execute(delete(AuthToken).where(AuthToken.user_id == user.id))
    await db.commit()
    return ok({"message": "密码已重置，请重新登录"})


@router.get("/users/me")
async def me(user: Actor):
    return ok(public_user(user))


@router.patch("/users/me")
async def profile(body: ProfileInput, db: DB, user: Actor):
    user.display_name = body.display_name.strip()
    await db.commit()
    return ok(public_user(user))


@router.post("/auth/change-password")
async def change_password(body: PasswordInput, request: Request, db: DB, user: Actor):
    await limit(request, "change-password", str(user.id))
    user = await db.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not await run_in_threadpool(verify_password, user.password_hash, body.current_password):
        raise AppError("INVALID_CREDENTIALS", "当前密码错误", 401)
    user.password_hash = await run_in_threadpool(hash_password, body.password)
    await db.execute(delete(AuthToken).where(AuthToken.user_id == user.id))
    await db.commit()
    return ok({"message": "密码已修改，请重新登录"})
