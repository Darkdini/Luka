#!/usr/bin/env python3
"""Нарезка арта «Чёрной Луны» (этап 1): art/source/night -> client/assets/night.
Запуск: python3 tools/slice_night.py [--debug]"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SET = next((a.split("=")[1] for a in sys.argv if a.startswith("--set=")), "realm")
SRC = os.path.join(ROOT, "art", "source", SET)
OUT = os.path.join(ROOT, "client", "assets", SET)
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
    """Объекты листа: связные компоненты распределяются по колонкам по центру масс
    (соседний меч или лук не попадёт в чужую вырезку)."""
    h, w = fg.shape
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, k = ndimage.label(fg)
    sizes = ndimage.sum(fg, lab, range(1, k + 1))
    cms = ndimage.center_of_mass(fg, lab, range(1, k + 1))
    groups = {i: [] for i in range(n)}
    for j, (sz, (cy, cx)) in enumerate(zip(sizes, cms), start=1):
        if sz < 400:
            continue
        groups[min(n - 1, int(cx / (w / n)))].append(j)
    for i, name in enumerate(names):
        m = np.isin(lab, groups[i])
        ys, xs = np.where(m)
        y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad)
        x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad)
        save_png(rgba(rgb[y0:y1, x0:x1], m[y0:y1, x0:x1]), f"{folder}/{name}.png", max_side)


PORTRAIT_SHIFT = {"elinor": 0.16}  # доля ширины: сдвиг центра (флаг тянет центр влево)


def portrait(src, dst):
    """Портрет для карточки: по центру корпуса (оружие не сбивает), голова сверху, 3:4."""
    im = Image.open(src).convert("RGBA")
    a = np.array(im)[..., 3].astype(np.float32) / 255
    h, w = a.shape
    rows = np.where(a.max(axis=1) > 0.5)[0]
    top, bot = rows[0], rows[-1]
    fh = bot - top
    band = a[top + int(fh * 0.14): top + int(fh * 0.30)]
    prof = band.sum(axis=0)
    prof = np.convolve(prof, np.ones(9) / 9, mode="same")
    cx = int(np.average(np.arange(w), weights=prof ** 2 + 1e-6))
    cx += int(w * PORTRAIT_SHIFT.get(os.path.basename(src)[:-4], 0))
    win = a[:, max(0, cx - int(w * 0.10)): cx + int(w * 0.10)]
    head = np.where(win.max(axis=1) > 0.5)[0]
    htop = head[0] if len(head) else top
    ph = int(fh * 0.40)
    pw = int(ph * 0.78)
    y0 = max(0, htop - int(ph * 0.05))
    x0 = max(0, min(w - pw, cx - pw // 2)) if pw < w else 0
    crop = im.crop((x0, y0, x0 + min(pw, w), y0 + ph))
    crop.thumbnail((360, 460), Image.LANCZOS)
    crop.save(dst, optimize=True)


UI_BOXES = {
    "emblem": (32, 22, 411, 446),
    "frame_iron_tall": (443, 15, 669, 448), "frame_blue": (701, 20, 942, 441), "frame_purple": (968, 15, 1225, 446),
    "title_plate": (21, 456, 443, 607),
    "btn_gold": (464, 473, 662, 541), "btn_steel": (464, 545, 662, 613),
    "btn_gold_pressed": (697, 473, 880, 541), "btn_steel_pressed": (697, 545, 880, 613),
    "ic_hero": (911, 463, 1010, 566), "ic_book": (911, 569, 1010, 672),
    "ic_battle": (1021, 464, 1120, 566), "ic_quest": (1021, 569, 1120, 672),
    "ic_settings": (1131, 463, 1230, 566), "ic_chest": (1131, 569, 1230, 672),
    "banner_bar": (23, 618, 468, 744), "bar_empty": (23, 752, 476, 800), "bar_full": (32, 803, 476, 891),
    "sign_chains": (498, 624, 916, 847),
    "dot_red": (1000, 732, 1048, 786), "ic_close": (1100, 710, 1199, 814),
    "frame_grey": (494, 878, 761, 1219), "frame_purple2": (787, 864, 1003, 1220), "frame_gold": (1016, 848, 1213, 1222),
}


def main():
    names = ["humans", "elves", "dwarves", "orcs"]
    # 1. Заставка
    save_jpg(load("splash.png"), "splash.jpg", 1600)

    # 2. Интро: 6 кадров 3x2
    it = load("intro_sheet.png")
    xs = [(3, 383), (386, 766), (769, 1149)]
    ys = [(1, 654), (684, 1349)]
    k = 1
    for (y0, y1) in ys:
        for (x0, x1) in xs:
            save_jpg(it[y0:y1, x0:x1], f"intro/{k}.jpg", 1400)
            k += 1

    # 3. Фоны рас
    fb = load("race_bgs.png")
    for name, (x0, x1) in zip(names, [(3, 470), (473, 939), (942, 1408), (1411, 1878)]):
        save_jpg(fb[:, x0:x1], f"races/bg_{name}.jpg", 1400)

    # 4. Наставники
    mt = load("mentors_sheet.png")
    fg = ~bg_mask(mt, 24)
    cut_columns(mt, fg, 4, [f"mentor_{n}" for n in names], "races", 900)

    # 5. Гербы и главные здания
    ch = load("crests_hq.png")
    h = ch.shape[0]
    fg = ~bg_mask(ch, 20)
    top, bot = slice(0, h // 2), slice(h // 2, h)
    cut_columns(ch[top], fg[top], 4, [f"crest_{n}" for n in names], "races", 360)
    cut_columns(ch[bot], fg[bot], 4, [f"hq_{n}" for n in names], "races", 520)

    # 6. Герои: 8 листов по 4, полный рост + портрет для карточки
    sheets = {
        "heroes_h1": ["elinor", "gaven", "mira", "rowan"], "heroes_h2": ["varrick", "selene", "edric", "hilda"],
        "heroes_e1": ["aerith", "thalion", "ysolde", "fenn"], "heroes_e2": ["elandor", "nyra", "caelum", "lirien"],
        "heroes_d1": ["durin", "brenna", "bolgar", "grim"], "heroes_d2": ["hrafna", "kargan", "odda", "thrain"],
        "heroes_o1": ["ashka", "murg", "tarrok", "skab"], "heroes_o2": ["gorrum", "vexa", "brakk", "gnash"],
    }
    for sheet_name, ids in sheets.items():
        if not os.path.exists(os.path.join(SRC, sheet_name + ".png")):
            continue
        hr = load(sheet_name + ".png")
        cut_columns(hr, ~bg_mask(hr, 24), 4, ids, "heroes", 900)
        for hid in ids:
            portrait(os.path.join(OUT, "heroes", hid + ".png"), os.path.join(OUT, "heroes", hid + "_p.png"))

    # 7. Арены боя (2 листа 2x2)
    k = 1
    for an in ["arenas2.png", "arenas1.png"]:
        if not os.path.exists(os.path.join(SRC, an)):
            continue
        ar = load(an)
        hh, ww = ar.shape[0] // 2, ar.shape[1] // 2
        for (y, x) in [(0, 0), (0, 1), (1, 0), (1, 1)]:
            save_jpg(ar[y * hh + 3:(y + 1) * hh - 3, x * ww + 3:(x + 1) * ww - 3], f"arenas/{k}.jpg", 900)
            k += 1

    # 8. Иконки героев 4x4 (круглые медальоны)
    if os.path.exists(os.path.join(SRC, "hero_icons.png")):
        ic = load("hero_icons.png")
        fg = ~bg_mask(ic, 16)
        names = [["tank_old", "dmg", "aoe", "heal"], ["support", "dev", "infantry", "archer"],
                 ["cavalry", "book", "statue", "frag"], ["ticket", "star", "rune", "upgrade"]]
        hh, ww = ic.shape[0] / 4, ic.shape[1] / 4
        for r in range(4):
            for c in range(4):
                y0, y1, x0, x1 = int(r * hh), int((r + 1) * hh), int(c * ww), int((c + 1) * ww)
                save_png(rgba(ic[y0:y1, x0:x1], fg[y0:y1, x0:x1]), f"icons/{names[r][c]}.png", 160)

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
    named = UI_BOXES
    for name, (x0, y0, x1, y1) in named.items():
        save_png(rgba(ui[y0:y1, x0:x1], fg[y0:y1, x0:x1]), f"ui/{name}.png")
    print("готово:", SET, "UI:", len(named))


if __name__ == "__main__":
    main()
