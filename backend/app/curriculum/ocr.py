import asyncio
import io

from PIL import Image, ImageOps, UnidentifiedImageError

from app.errors import AppError
from app.image_limits import MAX_IMAGE_BYTES

MAX_IMAGE = MAX_IMAGE_BYTES
Image.MAX_IMAGE_PIXELS = None


def normalize_image(content: bytes):
    if not content or len(content) > MAX_IMAGE:
        raise AppError("FILE_SIZE", "图片须为 1 字节至 50 MiB", 413)
    try:
        with Image.open(io.BytesIO(content)) as original:
            if original.format not in {"PNG", "JPEG", "WEBP", "BMP", "GIF", "TIFF", "AVIF"}:
                raise ValueError()
            if getattr(original, "n_frames", 1) != 1:
                raise AppError("FILE_TYPE", "请将动图或多页图片导出为单张图片后上传")
            original.load()
            oriented = ImageOps.exif_transpose(original)
            if oriented.has_transparency_data:
                rgba = oriented.convert("RGBA")
                image = Image.new("RGB", rgba.size, "white")
                image.paste(rgba, mask=rgba.getchannel("A"))
            else:
                image = oriented.convert("RGB")
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
