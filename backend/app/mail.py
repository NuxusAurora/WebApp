import json
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from app.errors import AppError


class Mailer:
    def __init__(self, settings):
        self.settings = settings

    def send(self, email: str, kind: str, token: str):
        settings = self.settings
        if settings.smtp_host:
            message = EmailMessage()
            message["From"] = settings.mail_from
            message["To"] = email
            message["Subject"] = "验证邮箱" if kind == "verify" else "重置密码"
            message.set_content(f"请在学习工作台输入此一次性验证码（30 分钟内有效）：\n{token}")
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                smtp.starttls()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password.get_secret_value())
                smtp.send_message(message)
            return
        if urlsplit(settings.public_origin).hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise AppError("MAIL_NOT_CONFIGURED", "邮件服务待配置，请稍后重试", 503)
        directory = Path(settings.mail_outbox)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = directory / f"{uuid4()}.json"
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as out:
            json.dump({"to": email, "kind": kind, "token": token}, out)
