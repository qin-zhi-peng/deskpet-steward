"""生成 README 头图（1280x640）。可重复运行：python tools/make-banner.py"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "shots" / "banner.png"
PET = ROOT / "assets" / "pet" / "xiaojing-portrait-512.png"
BRUSH = ROOT / "assets" / "fonts" / "LiuJianMaoCao-Regular.ttf"
SANS = "C:/Windows/Fonts/msyh.ttc"
SANS_BOLD = "C:/Windows/Fonts/msyhbd.ttc"

W, H = 1280, 640
BG_TOP = (13, 15, 21)
BG_BOTTOM = (6, 7, 10)
BLUE = (91, 124, 255)
TEXT = (236, 238, 244)
TEXT2 = (164, 170, 184)
TEXT3 = (111, 118, 135)
LINE = (35, 40, 51)


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def gradient():
    img = Image.new("RGB", (W, H), BG_BOTTOM)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line(
            [(0, y), (W, y)],
            fill=(
                int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
                int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
                int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
            ),
        )
    return img


def glow(canvas, center, radius, color=BLUE, alpha=70):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 26
    for i in range(steps, 0, -1):
        r = int(radius * i / steps)
        a = int(alpha * (1 - i / steps) ** 1.6)
        d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r], fill=color + (a,))
    layer = layer.filter(ImageFilter.GaussianBlur(28))
    canvas.alpha_composite(layer)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main():
    canvas = gradient().convert("RGBA")

    # 右侧光晕
    glow(canvas, (980, 330), 300, BLUE, 60)

    # 细网格
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(0, W, 48):
        gd.line([(x, 0), (x, H)], fill=(255, 255, 255, 6))
    for y in range(0, H, 48):
        gd.line([(0, y), (W, y)], fill=(255, 255, 255, 6))
    canvas.alpha_composite(grid)

    # 桌宠
    pet = Image.open(PET).convert("RGBA")
    pet.thumbnail((520, 520), Image.LANCZOS)
    canvas.alpha_composite(pet, (W - pet.width - 60, H - pet.height - 40))

    d = ImageDraw.Draw(canvas)

    x = 80
    d.text((x, 92), "D E S K P E T   S T E W A R D", font=font(SANS, 15), fill=TEXT3)

    d.text((x - 4, 150), "桌宠总管", font=font(SANS_BOLD, 92), fill=TEXT)

    d.text((x, 272), "personal agent 的桌宠版", font=font(SANS_BOLD, 32), fill=TEXT)
    d.text((x, 322), "桌面上趴着一只小鲸，屏幕后跑着一个本地 AI 总管：扫项目、", font=font(SANS, 19), fill=TEXT2)
    d.text((x, 352), "拆活、并行派工单，跑完回来找你拍板。", font=font(SANS, 19), fill=TEXT2)

    # 标签
    tags = ["项目地图", "并行工单", "长期记忆", "手机看板"]
    tx = x
    for t in tags:
        f = font(SANS, 16)
        tw = d.textlength(t, font=f)
        rounded(d, [tx, 412, tx + tw + 30, 452], 20, fill=(23, 27, 36, 255), outline=LINE, width=1)
        d.text((tx + 15, 422), t, font=f, fill=TEXT2)
        tx += tw + 30 + 12

    d.line([(x, 508), (x + 470, 508)], fill=LINE, width=1)
    parts = [("Node + Electron", TEXT3), ("   ·   ", TEXT3), ("密钥只留在本机 .env", (76, 195, 138)), ("   ·   ", TEXT3), ("MIT", TEXT3)]
    cx = x
    f = font(SANS, 16)
    for text, color in parts:
        d.text((cx, 528), text, font=f, fill=color)
        cx += d.textlength(text, font=f)

    # 左上角小方印
    rounded(d, [80, 40, 108, 68], 8, fill=(178, 58, 46, 255))
    d.text((86, 44), "总", font=font(SANS_BOLD, 18), fill=(247, 239, 223))

    canvas.convert("RGB").save(OUT, "PNG", optimize=True)
    print("saved", OUT, OUT.stat().st_size)


if __name__ == "__main__":
    main()
