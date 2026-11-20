#!/usr/bin/env python3
"""Сжатые копии картинок: для каждого PNG/JPG в client/assets — соседний .webp
(сервер отдаёт его браузерам, которые умеют WebP). Запуск: python3 tools/webp.py"""
import os
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "client", "assets")


def conv(path):
    out = path.rsplit(".", 1)[0] + "." + path.rsplit(".", 1)[1] + ".webp"
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(path):
        return 0, 0
    im = Image.open(path)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.mode or "transparency" in im.info else "RGB")
    im.save(out, "WEBP", quality=82, method=4)
    return os.path.getsize(path), os.path.getsize(out)


if __name__ == "__main__":
    files = [os.path.join(d, f) for d, _, fs in os.walk(ROOT) for f in fs if f.lower().endswith((".png", ".jpg", ".jpeg"))]
    with ProcessPoolExecutor() as ex:
        res = list(ex.map(conv, files, chunksize=8))
    a = sum(r[0] for r in res); b = sum(r[1] for r in res)
    print(f"файлов {len(files)}; сжато {a / 1e6:.1f} МБ → {b / 1e6:.1f} МБ")
