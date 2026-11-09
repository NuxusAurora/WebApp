"""Render the synthetic calculus TOC OCR fixture; never a real textbook photograph."""

import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

image = Image.new("RGB", (1400, 950), (246, 244, 238))
draw = ImageDraw.Draw(image)
font = ImageFont.truetype(sys.argv[1], 48)
for index, line in enumerate([
    "高等数学  目录", "第一章  函数与极限", "1.1  映射与函数                 1",
    "1.2  数列的极限                 12", "1.3  函数的极限                 20",
    "第二章  导数与微分", "2.1  导数概念                   45",
]):
    draw.text((100, 80 + index * 110), line, fill=(30, 30, 30), font=font)
image.rotate(0.6, resample=Image.Resampling.BICUBIC, fillcolor=(246, 244, 238)).filter(
    ImageFilter.GaussianBlur(0.35)
).save(sys.argv[2])
