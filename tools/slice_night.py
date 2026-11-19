#!/usr/bin/env python3
"""Нарезка арта «Чёрной Луны» (этап 1): art/source/night -> client/assets/night.
Запуск: python3 tools/slice_night.py [--debug]"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source", "night")
OUT = os.path.join(ROOT, "client", "assets", "night")
DEBUG = "--debug" in sys.argv


def load(name):
    return np.array(Image.open(os.path.join(SRC, name)).convert("RGB")).astype(np.int16)


def save_jpg(arr, rel, max_side=None, q=86):
    img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    if max_side and max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((round(img.size[0] * k), round(img.size[1] * k)), Image.LANCZOS)
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, quality=q, optimize=True)


def save_png(img, rel, max_side=None):
    if max_side and max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((round(img.size[0] * k), round(img.size[1] * k)), Image.LANCZOS)
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def bg_mask(rgb, tol):
    """Фон = связная с краями область, близкая к цвету углов."""
    corners = np.array([rgb[2, 2], rgb[2, -3], rgb[-3, 2], rgb[-3, -3]]).mean(0)
    dist = np.abs(rgb - corners).max(axis=2)
    lab, _ = ndimage.label(dist <= tol)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge != 0]
    return np.isin(lab, edge)


def rgba(rgb, fg):
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg)
    if n > 1:  # оставляем крупные куски, убираем пыль
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        fg = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * 0.02])
    a = (fg * 255).astype(np.uint8)
    a = np.minimum(np.array(Image.fromarray(a).filter(ImageFilter.GaussianBlur(0.9))), a)
    return Image.fromarray(np.dstack([rgb.clip(0, 255).astype(np.uint8), a]), "RGBA")


def cut_columns(rgb, fg, n, names, folder, max_side, pad=6):
    h, w = fg.shape
    for i, name in enumerate(names):
        x0, x1 = int(i * w / n), int((i + 1) * w / n)
        m = fg[:, x0:x1]
        ys, xs = np.where(m)
        y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad)
        a0, a1 = max(0, xs.min() - pad), min(x1 - x0, xs.max() + pad)
        save_png(rgba(rgb[y0:y1, x0 + a0:x0 + a1], m[y0:y1, a0:a1]), f"{folder}/{name}.png", max_side)


def main():
    # 1. Заставка: срезаем нарисованную полосу загрузки внизу
    sp = load("splash.png")
    save_jpg(sp[:1560], "splash.jpg", 1600)

    # 2. Интро: 6 кадров в сетке 3x2 с чёрными рамками
    it = load("intro_sheet.png")
    xs = [(2, 382), (389, 761), (769, 1149)]
    ys = [(1, 679), (687, 1364)]
    k = 1
    for (y0, y1) in ys:
        for (x0, x1) in xs:
            save_jpg(it[y0:y1, x0:x1], f"intro/{k}.jpg", 1400)
            k += 1

    # 3. Фоны фракций
    fb = load("faction_bgs.png")
    for name, (x0, x1) in zip(["vampires", "werewolves", "hunters", "mages"],
                              [(0, 466), (476, 936), (947, 1405), (1416, 1881)]):
        save_jpg(fb[:, x0:x1], f"factions/bg_{name}.jpg", 1400)

    # 4. Наставники в полный рост
    mt = load("mentors_sheet.png")
    fg = ~bg_mask(mt, 26)
    cut_columns(mt, fg, 4, ["mentor_vampires", "mentor_werewolves", "mentor_hunters", "mentor_mages"], "factions", 900)

    # 5. Гербы (верхняя половина) и штабы (нижняя)
    ch = load("crests_hq.png")
    h = ch.shape[0]
    fg = ~bg_mask(ch, 22)
    names = ["vampires", "werewolves", "hunters", "mages"]
    top = slice(0, h // 2)
    bot = slice(h // 2, h)
    cut_columns(ch[top], fg[top], 4, [f"crest_{n}" for n in names], "factions", 360)
    cut_columns(ch[bot], fg[bot], 4, [f"hq_{n}" for n in names], "factions", 520)

    # 6. UI-кит: связные компоненты, сохраняем по рамкам
    ui = load("ui_kit.png")
    fg = ~bg_mask(ui, 12)
    lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        y, x = sl
        if (y.stop - y.start) * (x.stop - x.start) < 900:
            continue
        boxes.append((x.start, y.start, x.stop, y.stop, i))
    if DEBUG:
        for b in sorted(boxes, key=lambda b: (b[1] // 60, b[0])):
            print(b)
    named = {
        "emblem": (22, 14, 513, 410), "panel_tall": (523, 12, 794, 415), "title_plate": (834, 11, 1244, 281),
        "sign_chains": (832, 292, 1244, 495),
        "btn_gold": (26, 423, 357, 511), "btn_gold_pressed": (371, 426, 682, 510),
        "btn_steel": (25, 520, 357, 609), "btn_steel_pressed": (371, 523, 681, 607),
        "bar_frame": (703, 509, 1237, 616),
        "ic_hero": (33, 626, 144, 752), "ic_battle": (170, 627, 280, 751), "ic_book": (307, 627, 417, 752),
        "ic_settings": (444, 627, 554, 751), "ic_trophy": (580, 627, 690, 752), "ic_mail": (716, 626, 826, 752),
        "ic_alliance": (845, 626, 954, 751), "ic_shop": (968, 627, 1076, 751), "ic_close": (1102, 663, 1225, 792),
        "bar_empty": (38, 767, 534, 822), "bar_full": (558, 766, 1094, 822),
        "frame_grey": (31, 836, 262, 1216), "frame_blue": (282, 835, 506, 1213),
        "frame_purple": (526, 835, 747, 1217), "frame_gold": (766, 836, 989, 1216),
        "divider": (1029, 844, 1072, 1186), "arrow": (1092, 1099, 1236, 1213),
        "gem_red": (1143, 852, 1191, 909), "gem_blue": (1143, 909, 1191, 967),
        "gem_purple": (1143, 967, 1191, 1025), "gem_gold": (1143, 1025, 1191, 1083),
    }
    for name, (x0, y0, x1, y1) in named.items():
        save_png(rgba(ui[y0:y1, x0:x1], fg[y0:y1, x0:x1]), f"ui/{name}.png")
    print("готово: заставка, 6 кадров интро, 4 фона, 4 наставника, 4 герба, 4 штаба, UI:", len(named))


if __name__ == "__main__":
    main()
