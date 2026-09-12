#!/usr/bin/env python3
# 生成 PWA 图标 PNG（192 / 512）。仅构建期使用，不参与运行时。
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
FONT = "/System/Library/Fonts/Helvetica.ttc"


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 渐变背景（左上 #1FAFA3 → 右下 #0E7490，与 icon.svg 保持一致）
    c1 = (31, 175, 163)
    c2 = (14, 116, 144)
    r = int(size * 0.1875)  # 96/512
    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    step = max(1, size // 256)
    for y in range(0, size, step):
        for x in range(0, size, step):
            t = (x + y) / max(1, (size * 2 - 2))
            gd.rectangle([x, y, x + step, y + step], fill=lerp(c1, c2, t) + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    img.paste(grad, (0, 0), mask)

    u = size / 512.0
    white = (255, 255, 255, 255)
    soft = (255, 255, 255, 140)

    # 地球：圆环 + 经纬线
    d.ellipse([144 * u, 88 * u, 368 * u, 312 * u], outline=white, width=int(18 * u))
    d.line([256 * u, 88 * u, 256 * u, 312 * u], fill=soft, width=int(14 * u))
    d.line([144 * u, 200 * u, 368 * u, 200 * u], fill=soft, width=int(14 * u))

    # 纸飞机
    d.polygon(
        [
            (120 * u, 372 * u),
            (392 * u, 300 * u),
            (360 * u, 392 * u),
            (288 * u, 360 * u),
            (232 * u, 424 * u),
        ],
        fill=white,
    )

    # 日期
    try:
        font = ImageFont.truetype(FONT, int(52 * u))
    except Exception:
        font = ImageFont.load_default()
    text = "9.26–10.7"
    bbox = d.textbbox((0, 0), text, font=font)
    d.text(
        ((size - (bbox[2] - bbox[0])) / 2 - bbox[0], 470 * u - bbox[1]),
        text,
        font=font,
        fill=white,
    )
    return img


for s in (192, 512):
    draw(s).save(os.path.join(BASE, "icon-%d.png" % s), "PNG", optimize=True)
    print("icon-%d.png" % s)
