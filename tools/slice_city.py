#!/usr/bin/env python3
"""Нарезка листов города (art/source/realm/city_*.png) -> client/assets/realm/city/.
Для объектов на ромбовидной плите считает «якорь»: центр верхней грани ромба
и его ширину в пикселях — по ним клиент сажает здание точно на клетки сетки.
Запуск: python3 tools/slice_city.py [--debug]"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice_ui import extract, fit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source", "realm")
OUT = os.path.join(ROOT, "client", "assets", "realm", "city")
DEBUG = "--debug" in sys.argv

R = ["humans", "elves", "dwarves", "orcs"]
SHEETS = {
    "city_castles.png": ([f"castle_{r}_1" for r in R] + [f"castle_{r}_2" for r in R], 560, "slab"),
    "city_res.png": (["farm", "sawmill", "quarry", "mine", "manaspring", "market"], 440, "slab"),
    "city_mil.png": (["barracks", "range", "stables", "hospital", "forge", "academy"], 440, "slab"),
    "city_special.png": (["warehouse", "tavern", "altar", "statue", "advisor", "embassy"], 440, "slab"),
    "city_walls.png": (["wall_r", "wall_l", "tower", "gate", "rubble", "ruin_hut", "logs", "fence",
                        "scaffold", "captured", "stones", "deadtree"], 400, "slab"),
    "city_nature.png": (["tex_grass", "tex_dirt", "tile_grass", "tile_stone", "pine", "oak", "pine2", "oak2",
                         "forest_pine", "forest_mixed", "bush", "bush2", "rock", "rock2", "flowers"], 420, "foot"),
    "city_icons.png": (["food", "wood", "stone", "iron", "mana", "speedup", "build", "info", "upgrade", "collect",
                        "train", "research", "move", "repair", "builder", "enemy", "quest", "energy", "shield", "timer"], 128, None),
}
SPLIT = {"city_castles.png": 8, "city_icons.png": 6}
DIL = {"city_castles.png": 4, "city_icons.png": 3, "city_nature.png": 4}
TEXTURES = {"tex_grass", "tex_dirt"}
SLAB_IN_NATURE = {"tile_grass", "tile_stone"}


def main_mask(img):
    """Альфа-маска самого крупного куска (без случайных крошек)."""
    a = np.array(img)[..., 3] > 128
    lab, n = ndimage.label(a)
    if n > 1:
        sizes = ndimage.sum(a, lab, range(1, n + 1))
        a = lab == (int(np.argmax(sizes)) + 1)
    return a


def slab_anchor(img):
    """Плита-параллелограмм в изометрии 2:1. L/R — левый и правый углы верхней грани,
    B — нижний угол. Центр плиты = середина диагонали LR. sa = xB-xL (сторона вдоль X сетки),
    sb = xR-xB (вдоль Y). Ширина ромба dw = sa+sb."""
    a = main_mask(img)
    h, w = a.shape
    cols = np.where(a.any(0))[0]
    xl, xr = int(cols[0]), int(cols[-1])

    def span(x):
        ys = np.where(a[:, x])[0]
        return int(ys[0]), int(ys[-1])
    tl, bl = span(min(xl + 2, w - 1))
    tr, br = span(max(xr - 2, 0))
    thick = float(np.median([bl - tl, br - tr]))
    yl, yr = bl - thick, br - thick          # верх боковины у углов = углы верхней грани
    yb = int(np.where(a.any(1))[0][-1])
    xs = np.where(a[yb - 2:yb + 1].any(0))[0]
    xb = float(xs.mean())
    return dict(ax=round((xl + xr) / 2, 1), ay=round((yl + yr) / 2, 1),
                sa=round(xb - xl, 1), sb=round(xr - xb, 1), dw=float(xr - xl), thick=round(thick, 1))


def foot_anchor(img):
    a = main_mask(img)
    rows = np.where(a.any(1))[0]
    yb = rows[-1]
    xs = np.where(a[max(0, yb - 6):yb + 1].any(0))[0]
    cols = np.where(a.any(0))[0]
    return dict(ax=round((xs[0] + xs[-1]) / 2, 1), ay=float(yb - 4), dw=float(cols[-1] - cols[0]))


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for sheet, (names, side, kind) in SHEETS.items():
        imgs = extract(os.path.join(SRC, sheet), len(names), dil=DIL.get(sheet, 7), glow=sheet == "city_nature.png", split=SPLIT.get(sheet, 0))
        dbg_items = []
        for img, nm in zip(imgs, names):
            if nm in TEXTURES:  # бесшовная текстура: квадрат без альфы, обрезаем край на 4px
                im = img.convert("RGB")
                im = im.crop((4, 4, im.size[0] - 4, im.size[1] - 4)).resize((256, 256), Image.LANCZOS)
                im.save(os.path.join(OUT, nm + ".jpg"), quality=88)
                manifest[nm] = dict(w=256, h=256)
                continue
            img = fit(img, side)
            img.save(os.path.join(OUT, nm + ".png"), optimize=True)
            meta = dict(w=img.size[0], h=img.size[1])
            if kind == "slab" or nm in SLAB_IN_NATURE:
                meta.update(slab_anchor(img))
            elif kind == "foot":
                meta.update(foot_anchor(img))
            manifest[nm] = meta
            dbg_items.append((nm, img, meta))
        if DEBUG and dbg_items:
            W = sum(i.size[0] + 10 for _, i, _ in dbg_items)
            H = max(i.size[1] for _, i, _ in dbg_items) + 20
            sheet_img = Image.new("RGB", (W, H), (60, 90, 70))
            d = ImageDraw.Draw(sheet_img)
            x = 0
            for nm, im, m in dbg_items:
                sheet_img.paste(im, (x, 0), im)
                if "dw" in m:
                    ax, ay, dw = x + m["ax"], m["ay"], m["dw"]
                    pts = [(ax - dw / 2, ay), (ax, ay - dw / 4), (ax + dw / 2, ay), (ax, ay + dw / 4)]
                    d.polygon(pts, outline=(255, 0, 0))
                    d.ellipse([ax - 3, ay - 3, ax + 3, ay + 3], fill=(255, 0, 0))
                d.text((x + 4, H - 16), nm, fill=(255, 255, 255))
                x += im.size[0] + 10
            sheet_img.save(os.path.join(ROOT, "..", "dbg_" + sheet.replace(".png", ".jpg")) if False else
                           os.path.join(os.environ.get("DBG", OUT), "_dbg_" + sheet.replace(".png", ".jpg")))
    if os.path.exists(os.path.join(OUT, "tex_cobble.jpg")):  # tools/make_cobble.py
        manifest["tex_cobble"] = dict(w=256, h=256)
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=0)
    print("готово:", OUT, len(manifest))


if __name__ == "__main__":
    main()
