import re

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.errors import AppError

MAX_UPLOAD = 1024 * 1024


def inspect_text(filename: str, content: bytes):
    if not re.fullmatch(r"[^/\\\x00-\x1f]{1,190}\.txt", filename, re.IGNORECASE):
        raise AppError("FILE_TYPE", "仅支持 UTF-8 .txt 文件")
    if not content or len(content) > MAX_UPLOAD:
        raise AppError("FILE_SIZE", "文件须为 1 字节至 1 MiB", 413)
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise AppError("UNSAFE_FILE", "文件必须为 UTF-8 纯文本") from None
    if any(ord(c) < 32 and c not in "\t\r\n" for c in text) or any(
        marker in text.lower()
        for marker in (
            "eicar-standard-antivirus-test-file",
            "<script",
            "<html",
            "javascript:",
            "<iframe",
            "<object",
            "<svg",
            "<!doctype",
            "powershell -enc",
        )
    ):
        raise AppError("UNSAFE_FILE", "文件含有不支持的活动内容或恶意标记")


class ObjectStore:
    def __init__(self, settings):
        self.bucket = settings.storage_bucket
        options = dict(
            aws_access_key_id=settings.storage_access_key.get_secret_value(),
            aws_secret_access_key=settings.storage_secret_key.get_secret_value(),
            region_name=settings.storage_region,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                connect_timeout=3,
                read_timeout=10,
                retries={"max_attempts": 1},
            ),
        )
        self.client = boto3.client("s3", endpoint_url=settings.storage_endpoint, **options)
        self.public = boto3.client("s3", endpoint_url=settings.storage_public_endpoint, **options)

    def put(self, key, content):
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError as error:
            if error.response["Error"]["Code"] not in {"404", "NoSuchBucket"}:
                raise
            try:
                self.client.create_bucket(Bucket=self.bucket)
            except ClientError as creation:
                if creation.response["Error"]["Code"] != "BucketAlreadyOwnedByYou":
                    raise
        self.client.put_object(
            Bucket=self.bucket, Key=key, Body=content, ContentType="text/plain; charset=utf-8"
        )

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def download(self, key):
        return self.public.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentType": "text/plain; charset=utf-8",
                "ResponseContentDisposition": 'attachment; filename="learning-material.txt"',
            },
            ExpiresIn=60,
        )

    def close(self):
        self.client.close()
        self.public.close()
