import asyncio
import io

from PIL import Image, ImageOps, UnidentifiedImageError

from app.errors import AppError
from app.image_limits import MAX_IMAGE_BYTES

MAX_IMAGE = MAX_IMAGE_BYTES
Image.MAX_IMAGE_PIXELS = None


def normalize_image(content: bytes, *, diagnostics: dict | None = None):
    details = diagnostics if diagnostics is not None else {}
    details["stage"] = "input"
    if not content or len(content) > MAX_IMAGE:
        details.update(reason="input_size", exception_type="AppError")
        raise AppError("FILE_SIZE", "图片须为 1 字节至 50 MiB", 413)
    try:
        details["stage"] = "open"
        with Image.open(io.BytesIO(content)) as original:
            details.update(
                stage="inspect",
                detected_format=original.format,
                dimensions=list(original.size),
                mode=original.mode,
            )
            if original.format not in {"PNG", "JPEG", "WEBP", "BMP", "GIF", "TIFF", "AVIF"}:
                details["reason"] = "unsupported_format"
                raise ValueError()
            details["frames"] = getattr(original, "n_frames", 1)
            if details["frames"] != 1:
                details["reason"] = "multiple_frames"
                raise AppError("FILE_TYPE", "请将动图或多页图片导出为单张图片后上传")
            details["stage"] = "decode"
            original.load()
            details["stage"] = "transform"
            oriented = ImageOps.exif_transpose(original)
            if oriented.has_transparency_data:
                rgba = oriented.convert("RGBA")
                image = Image.new("RGB", rgba.size, "white")
                image.paste(rgba, mask=rgba.getchannel("A"))
            else:
                image = oriented.convert("RGB")
            output = io.BytesIO()
            details["stage"] = "encode"
            image.save(output, format="PNG")
            value = output.getvalue()
            details["output_bytes"] = len(value)
            if len(value) > MAX_IMAGE:
                details["reason"] = "output_size"
                raise AppError("FILE_SIZE", "图片解码后过大，请缩小图片", 413)
            details["stage"] = "complete"
            return value
    except AppError:
        details["exception_type"] = "AppError"
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        details["exception_type"] = type(error).__name__
        # Classify decoder failures, never retain arbitrary exception text from an upload.
        reason = (
            "unrecognized_image"
            if isinstance(error, UnidentifiedImageError)
            else "truncated_image"
            if "truncated" in str(error).lower()
            else "corrupt_stream"
            if "broken data stream" in str(error).lower()
            else "decoder_rejected"
        )
        details.setdefault("reason", reason)
        raise AppError(
            "FILE_TYPE", "请选择有效的 PNG、JPEG、WebP、BMP、GIF、TIFF 或 AVIF 图片"
        ) from None


class LocalOCR:
    def __init__(self):
        self.slots = asyncio.Semaphore(2)

    async def recognize(self, content: bytes):
        async with self.slots:
            process = None
            try:
                async with asyncio.timeout(35):
                    process = await asyncio.create_subprocess_exec(
                        "tesseract",
                        "stdin",
                        "stdout",
                        "-l",
                        "chi_sim+eng",
                        "--psm",
                        "6",
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    output, _ = await process.communicate(content)
                text = output.decode("utf-8").strip()
                if process.returncode or not text or len(text) > 20000:
                    raise AppError("OCR_FAILED", "未识别出有效目录，请换清晰图片或输入文字")
                return text
            except FileNotFoundError:
                raise AppError("OCR_UNAVAILABLE", "本地 OCR 未安装，请输入目录文字", 503) from None
            except TimeoutError:
                raise AppError("OCR_TIMEOUT", "识别超时，请缩小图片后重试", 504) from None
            finally:
                if process is not None and process.returncode is None:
                    process.kill()
                    await process.communicate()
