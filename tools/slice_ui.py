#!/usr/bin/env python3
"""Нарезка листов интерфейса (art/source/realm/ui_*.png) -> client/assets/realm/kit/.
Фон — ровный светло-серый. Альфа мягкая: свечение (стрелка-подсказка, камни)
сохраняется полупрозрачным, цвет «снимается» с фона.
Запуск: python3 tools/slice_ui.py [--debug]"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source", "realm")
OUT = os.path.join(ROOT, "client", "assets", "realm", "kit")

SHEETS = {
    # построчно, слева направо
    "ui_nav.png": ["arrow_l", "arrow_r", "back", "pointer",
                   "up", "up_off", "plus", "close",
                   "x1", "x2", "skip", "gear",
                   "chev_l", "chev_r", "info", "lock"],
    "ui_panels.png": ["navbar", "tab_on", "tab_off", "title",
                      "panel", "box", "bar_frame", "bar_gold",
                      "bar_green", "bar_red", "bar_yellow", "power",
                      "dot_red", "dot_green", "ring", "ring_lock"],
    "ui_icons.png": ["atk", "def", "hp", "spd", "power_ic",
                     "gems", "gold", "book", "ticket", "frag",
                     "statue", "chest", "gift", "padlock", "tank",
                     "dmg", "aoe", "heal", "support", "assassin"],
}
MAX_SIDE = {"panel": 700, "navbar": 900, "title": 700}
ICON_SIDE = 160


def background(rgb):
    """Фон с учётом лёгкой виньетки: размытое среднее по фоновым пикселям."""
    corners = np.array([rgb[3, 3], rgb[3, -4], rgb[-4, 3], rgb[-4, -4]]).mean(0)
    near = np.abs(rgb - corners).max(axis=2) <= 14
    k = 8  # считаем на уменьшенной копии
    h, w = near.shape
    small = lambda a: a[: h // k * k, : w // k * k].reshape(h // k, k, w // k, k, *a.shape[2:]).mean((1, 3))
    m = small(near.astype(float))
    c = small(rgb * near[..., None])
    for _ in range(40):  # заполняем «дыры» под объектами соседними значениями
        ms = ndimage.uniform_filter(m, 5)
        cs = np.stack([ndimage.uniform_filter(c[..., i], 5) for i in range(3)], -1)
        fill = m < 0.5
        if not fill.any():
            break
        c = np.where(fill[..., None], cs, c)
        m = np.where(fill, ms, m)
    bg = c / np.maximum(m, 1e-3)[..., None]
    bg = np.repeat(np.repeat(bg, k, 0), k, 1)
    out = np.empty_like(rgb, dtype=float)
    out[:] = corners
    out[: bg.shape[0], : bg.shape[1]] = bg
    return out


def extract(path, expect=None, gap=90, dil=7, glow=True, split=0, holes=False):
    """Возвращает список RGBA-картинок элементов листа (построчно, слева направо)."""
    rgb = np.array(Image.open(path).convert("RGB")).astype(float)
    bg = background(rgb)
    dist = np.abs(rgb - bg).max(axis=2)
    solid = ndimage.binary_fill_holes(ndimage.binary_opening(dist > 22, iterations=1))
    soft = np.clip((dist - 5) / 40, 0, 1)
    alpha = np.maximum(soft, ndimage.binary_erosion(solid, iterations=1))
    if holes:  # крупные «окна» фона внутри силуэта (между рукой и телом, под конём) — прозрачные
        inner = ndimage.binary_fill_holes(solid) & (dist <= 16)
        lab, n = ndimage.label(inner)
        if n:
            sizes = ndimage.sum(inner, lab, range(1, n + 1))
            big = np.isin(lab, [i + 1 for i, v in enumerate(sizes) if v >= 250])
            big = ndimage.binary_dilation(big, iterations=1)
            alpha = np.where(big, np.minimum(alpha, soft), alpha)
    # группы: сплошные части + ореол свечения
    grp, n = ndimage.label(ndimage.binary_dilation(solid | (soft > 0.25) if glow else solid, iterations=dil))
    if split:  # касающиеся элементы: ядра после эрозии, пиксели — ближайшему ядру
        core, nc = ndimage.label(ndimage.binary_erosion(solid, iterations=split))
        sizes = ndimage.sum(core > 0, core, range(1, nc + 1))
        keep = np.isin(core, [i + 1 for i, v in enumerate(sizes) if v >= 800])
        core = np.where(keep, core, 0)
        _, (iy, ix) = ndimage.distance_transform_edt(core == 0, return_indices=True)
        region = ndimage.binary_dilation(solid, iterations=dil)
        grp = np.where(region, core[iy, ix], 0)
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(grp)):
        if (grp[sl] == i + 1).sum() < 1500:
            continue
        boxes.append((sl, i + 1))
    cy = lambda b: (b[0][0].start + b[0][0].stop) / 2
    boxes.sort(key=cy)
    rows, cur = [], []
    for b in boxes:
        if cur and cy(b) - cy(cur[-1]) > gap:
            rows.append(cur)
            cur = []
        cur.append(b)
    rows.append(cur)
    ordered = [b for r in rows for b in sorted(r, key=lambda b: b[0][1].start)]
    if expect is not None and len(ordered) != expect:
        print(f"{os.path.basename(path)}: найдено {len(ordered)} элементов, ожидалось {expect}")
    out = []
    for sl, lab in ordered:
        a = alpha[sl] * (grp[sl] == lab)
        a = np.where(a < 0.04, 0, a)
        # снимаем фон с полупрозрачных пикселей
        col = (rgb[sl] - bg[sl] * (1 - a[..., None])) / np.maximum(a[..., None], 1e-3)
        col = np.where(a[..., None] > 0.98, rgb[sl], col).clip(0, 255)
        img = Image.fromarray(np.dstack([col, a * 255]).astype(np.uint8), "RGBA")
        out.append(img.crop(img.getbbox()))
    return out


def fit(img, side):
    if max(img.size) > side:
        k = side / max(img.size)
        img = img.resize((round(img.size[0] * k), round(img.size[1] * k)), Image.LANCZOS)
    return img


def cut(name, names):
    os.makedirs(OUT, exist_ok=True)
    for img, nm in zip(extract(os.path.join(SRC, name), len(names)), names):
        side = ICON_SIDE if name == "ui_icons.png" else MAX_SIDE.get(nm, 360)
        fit(img, side).save(os.path.join(OUT, nm + ".png"), optimize=True)


def main():
    for name, names in SHEETS.items():
        cut(name, names)
    print("готово:", OUT)


if __name__ == "__main__":
    main()
