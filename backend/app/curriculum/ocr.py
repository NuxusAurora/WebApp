import asyncio
import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from app.errors import AppError

MAX_IMAGE = 5 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16_000_000


def normalize_image(content: bytes):
    if not content or len(content) > MAX_IMAGE:
        raise AppError("FILE_SIZE", "图片须为 1 字节至 5 MiB", 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as original:
                if original.format not in {"PNG", "JPEG"} or getattr(original, "n_frames", 1) != 1:
                    raise ValueError()
                original.load()
                image = ImageOps.exif_transpose(original).convert("RGB")
                if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                    raise ValueError()
                output = io.BytesIO()
                image.save(output, format="PNG")
                value = output.getvalue()
                if len(value) > MAX_IMAGE:
                    raise AppError("FILE_SIZE", "图片解码后过大，请缩小图片", 413)
                return value
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise AppError("FILE_TYPE", "请选择有效的 PNG 或 JPEG 图片，最多 1600 万像素") from None


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
