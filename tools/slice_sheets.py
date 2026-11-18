#!/usr/bin/env python3
"""Нарезка AI-листов (sprite sheets) на отдельные PNG для игры.

Запуск:  python3 tools/slice_sheets.py
Берёт исходники из art/source, пишет результат в client/assets.

Как работает:
  1. Фон (тёмная «шахматка», чёрный или серый) заливается от краёв картинки
     (flood fill) по пикселям, похожим на фон, — так внутренние тёмные детали
     объектов не съедаются.
  2. Оставшиеся пиксели разбиваются на связные компоненты; каждая компонента
     относится к ячейке сетки, в которую попадает её центр.
  3. Каждая ячейка обрезается по своим компонентам, края слегка сглаживаются.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source")
OUT = os.path.join(ROOT, "client", "assets")


def load_rgb(name):
    return np.array(Image.open(os.path.join(SRC, name)).convert("RGB")).astype(np.int16)


def bg_candidates(rgb, max_val, max_sat):
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    return (mx <= max_val) & ((mx - mn) <= max_sat)


def flood_from_border(cand):
    lab, _ = ndimage.label(cand)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    border = border[border != 0]
    return np.isin(lab, border)


def light_candidates(rgb, min_val, max_sat):
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    return (mx >= min_val) & ((mx - mn) <= max_sat)


def foreground_mask(rgb, max_val=48, max_sat=22, light=None):
    if light:  # светлый фон (+ серые тени под объектами)
        cand = light_candidates(rgb, light, max_sat)
    else:
        cand = bg_candidates(rgb, max_val, max_sat)
    bg = flood_from_border(cand)
    fg = ~bg
    fg = ndimage.binary_opening(fg, iterations=1)
    return fg


def to_rgba(rgb, fg):
    alpha = (fg * 255).astype(np.uint8)
    a_img = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8))
    alpha = np.minimum(np.array(a_img), alpha)  # мягкий край внутрь, без ореола
    out = np.dstack([rgb.clip(0, 255).astype(np.uint8), alpha])
    return Image.fromarray(out, "RGBA")


def slice_grid(rgb, fg, cols, rows, min_area=600):
    h, w = fg.shape
    lab, n = ndimage.label(fg)
    if n == 0:
        return {}
    idx = np.arange(1, n + 1)
    areas = ndimage.sum(np.ones_like(lab), lab, idx)
    cms = ndimage.center_of_mass(np.ones_like(lab), lab, idx)
    cw, ch = w / cols, h / rows
    slices = ndimage.find_objects(lab)
    cell_masks = {}
    split = np.zeros(fg.shape, bool)  # компоненты, слипшиеся через границу ячеек
    for i, (area, (cy, cx)) in enumerate(zip(areas, cms), start=1):
        if area < min_area:
            continue
        sy, sx = slices[i - 1]
        if (sx.stop - sx.start) > cw * 1.15 or (sy.stop - sy.start) > ch * 1.15:
            split |= lab == i
            continue
        c = min(cols - 1, int(cx / cw))
        r = min(rows - 1, int(cy / ch))
        cell_masks.setdefault((r, c), []).append(i)
    result = {}
    for r in range(rows):
        for c in range(cols):
            labels = cell_masks.get((r, c), [])
            m = np.isin(lab, labels) if labels else np.zeros(fg.shape, bool)
            if split.any():
                part = np.zeros(fg.shape, bool)
                part[int(r * ch):int((r + 1) * ch), int(c * cw):int((c + 1) * cw)] = True
                m |= split & part
            if m.sum() < min_area:
                continue
            # убираем «хвосты» соседей: мелкие куски, касающиеся края ячейки
            sub, k = ndimage.label(m)
            if k > 1:
                sizes = ndimage.sum(m, sub, range(1, k + 1))
                big = sizes.max()
                y_top, y_bot = int(r * ch), int((r + 1) * ch) - 1
                for j, sz in enumerate(sizes, start=1):
                    ys = np.where((sub == j).any(axis=1))[0]
                    small = sz < big * 0.25 or (ys.max() - ys.min()) < ch * 0.2
                    if small and (ys.min() <= y_top + 2 or ys.max() >= y_bot - 2):
                        m[sub == j] = False
            result[(r, c)] = m
    for (r, c), m in list(result.items()):
        ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        pad = 4
        y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
        y1, x1 = min(h, y1 + pad), min(w, x1 + pad)
        result[(r, c)] = to_rgba(rgb[y0:y1, x0:x1], m[y0:y1, x0:x1])
    return result


def save(img, rel, max_side=None):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if max_side and max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((round(img.size[0] * k), round(img.size[1] * k)), Image.LANCZOS)
    img.save(path, optimize=True)
    return img.size


def sheet(name, cols, rows, names, folder, max_side, **kw):
    rgb = load_rgb(name)
    fg = foreground_mask(rgb, **kw)
    cells = slice_grid(rgb, fg, cols, rows)
    sizes = {}
    for r in range(rows):
        for c in range(cols):
            key = names[r][c]
            if key is None:
                continue
            if (r, c) not in cells:
                print(f"  !! {name}: пустая ячейка {r},{c} ({key})", file=sys.stderr)
                continue
            sizes[key] = save(cells[(r, c)], f"{folder}/{key}.png", max_side)
    print(f"{name}: {len(sizes)} спрайтов")
    return sizes


def glow_fx(name, cols, rows, names, folder, max_side, skip_rows=(), alpha=False):
    """Эффекты на тёмном фоне: вычитаем фон -> рисуются в режиме 'lighter'.
    alpha=True: настоящая прозрачность (яркость -> альфа), годится для DOM/CSS."""
    rgb = load_rgb(name).astype(np.float32)
    h, w, _ = rgb.shape
    sizes = {}
    for r in range(rows):
        if r in skip_rows:
            continue
        for c in range(cols):
            key = names[r][c]
            if key is None:
                continue
            y0, y1 = int(r * h / rows), int((r + 1) * h / rows)
            x0, x1 = int(c * w / cols), int((c + 1) * w / cols)
            cell = np.clip((rgb[y0:y1, x0:x1] - 36) * 1.12, 0, 255)
            if alpha:
                a = cell.max(axis=2, keepdims=True)
                col = np.where(a > 0, cell / np.maximum(a, 1) * 255, 0)
                out = np.concatenate([col, np.clip(a * 1.15, 0, 255)], axis=2).astype(np.uint8)
                sizes[key] = save(Image.fromarray(out, "RGBA"), f"{folder}/{key}.png", max_side)
            else:
                sizes[key] = save(Image.fromarray(cell.astype(np.uint8), "RGB"), f"{folder}/{key}.png", max_side)
    print(f"{name}: {len(sizes)} эффектов")
    return sizes


def round_icons(name, cols, rows, row, names, folder, size):
    """Круглые иконки: вырезаем круг из ячейки."""
    rgb = load_rgb(name)
    fg = foreground_mask(rgb, max_val=50, max_sat=24)
    h, w = fg.shape
    for c, key in enumerate(names):
        y0, y1 = int(row * h / rows), int((row + 1) * h / rows)
        x0, x1 = int(c * w / cols), int((c + 1) * w / cols)
        m = fg[y0:y1, x0:x1]
        ys, xs = np.where(m)
        cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
        rad = max(ys.max() - ys.min(), xs.max() - xs.min()) // 2 + 2
        crop = rgb[y0 + cy - rad:y0 + cy + rad, x0 + cx - rad:x0 + cx + rad]
        yy, xx = np.mgrid[0:crop.shape[0], 0:crop.shape[1]]
        circle = ((yy - rad) ** 2 + (xx - rad) ** 2) <= (rad - 1) ** 2
        save(to_rgba(crop, circle), f"{folder}/{key}.png", size)
    print(f"{name}: {len(names)} иконок")


def rect_crops(name, crops, folder, max_side=None, remove_bg=None):
    rgb = load_rgb(name)
    fg = foreground_mask(rgb, **remove_bg) if remove_bg else None
    for key, (x0, y0, x1, y1) in crops.items():
        part = rgb[y0:y1, x0:x1]
        if fg is not None:
            img = to_rgba(part, fg[y0:y1, x0:x1])
        else:
            img = Image.fromarray(part.clip(0, 255).astype(np.uint8), "RGB")
        save(img, f"{folder}/{key}.png", max_side)
    print(f"{name}: {len(crops)} вырезок")


def ui_kit():
    """UI-лист на светло-сером фоне: фон убираем по цвету, вырезаем по рамкам."""
    rgb = load_rgb("ui_kit.png")
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    cand = (mx >= 170) & (mx <= 215) & ((mx - mn) <= 14)
    fg = ~flood_from_border(cand)
    fg = ndimage.binary_opening(fg, iterations=1)
    crops = {
        "btn_green": (28, 26, 440, 168),
        "btn_red": (455, 26, 815, 168),
        "icon_gem": (846, 136, 926, 216),
        "badge_shield": (1286, 116, 1450, 290),
        "star": (905, 252, 1025, 366),
        "star_empty": (1240, 252, 1348, 366),
        "trophy": (905, 362, 1142, 548),
        "level_badge": (24, 540, 302, 810),
        "upgrade_arrow": (324, 556, 580, 800),
        "close": (614, 558, 822, 770),
        "btn_settings": (26, 830, 182, 990),
        "btn_mail": (194, 830, 349, 990),
        "btn_stats": (360, 830, 516, 990),
        "btn_help": (524, 830, 682, 990),
        "btn_trophy": (688, 830, 844, 990),
        "icon_food": (1210, 24, 1292, 110),
    }
    for key, (x0, y0, x1, y1) in crops.items():
        m = fg[y0:y1, x0:x1].copy()
        lab, k = ndimage.label(m)
        if k > 1:
            sizes = ndimage.sum(m, lab, range(1, k + 1))
            m = lab == (int(np.argmax(sizes)) + 1)
            m = ndimage.binary_fill_holes(m)
        save(to_rgba(rgb[y0:y1, x0:x1], m), f"ui/{key}.png", 256)
    # монета приклеена к плашке — вырезаем кругом
    cx, cy, rad = 889, 70, 41
    crop = rgb[cy - rad:cy + rad, cx - rad:cx + rad]
    yy, xx = np.mgrid[0:2 * rad, 0:2 * rad]
    save(to_rgba(crop, ((yy - rad) ** 2 + (xx - rad) ** 2) <= (rad - 1) ** 2), "ui/icon_gold.png", 256)
    print(f"ui_kit.png: {len(crops)} элементов")


def army_camp_gif():
    g = Image.open(os.path.join(SRC, "army_camp.gif"))
    g.seek(0)
    rgb = np.array(g.convert("RGB")).astype(np.int16)
    fg = foreground_mask(rgb, max_val=60, max_sat=22)
    ys, xs = np.where(fg)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    save(to_rgba(rgb[y0:y1, x0:x1], fg[y0:y1, x0:x1]), "buildings/armycamp_1.png", 420)
    print("army_camp.gif: 1 спрайт")


def backgrounds():
    for src, dst, side in [
        ("loading_battle.png", "bg/loading.jpg", 1920),
        ("world_map.png", "bg/world_map.jpg", 2400),
        ("base_bg.png", "bg/base.jpg", 2400),
        ("splash_vertical.png", "bg/splash.jpg", 1400),
        ("campaign_vertical.png", "bg/campaign.jpg", 1800),
        ("town_panorama.png", "bg/town.jpg", 2400),
    ]:
        img = Image.open(os.path.join(SRC, src)).convert("RGB")
        path = os.path.join(OUT, dst)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if max(img.size) > side:
            k = side / max(img.size)
            img = img.resize((round(img.size[0] * k), round(img.size[1] * k)), Image.LANCZOS)
        img.save(path, quality=88, optimize=True)
    g = Image.open(os.path.join(SRC, "grass.png")).convert("RGB").resize((768, 512), Image.LANCZOS)
    g.save(os.path.join(OUT, "bg/grass.jpg"), quality=88)
    print("фоны: 3")


def main():
    manifest = {}
    manifest.update(sheet("castle_sheet.png", 3, 2,
                          [["castle_1", "castle_2", "castle_3"], ["castle_4", "castle_5", "castle_6"]],
                          "buildings", 440))
    manifest.update(sheet("defense_sheet.png", 3, 4,
                          [[f"archertower_{i}" for i in (1, 2, 3)],
                           [f"ballista_{i}" for i in (1, 2, 3)],
                           [f"trebuchet_{i}" for i in (1, 2, 3)],
                           [f"magetower_{i}" for i in (1, 2, 3)]],
                          "buildings", 360))
    manifest.update(sheet("economy_sheet.png", 3, 4,
                          [[f"goldmine_{i}" for i in (1, 2, 3)],
                           [f"farm_{i}" for i in (1, 2, 3)],
                           [f"treasury_{i}" for i in (1, 2, 3)],
                           [f"granary_{i}" for i in (1, 2, 3)]],
                          "buildings", 380, max_val=70, max_sat=60))
    manifest.update(sheet("decor_sheet.png", 4, 4,
                          [["oak", "pine", "bush", "rock_big"],
                           ["rocks", "stump", "mushrooms", "flowers"],
                           ["log", "haystack", "well", "signpost"],
                           ["banner", "campfire", "gems", "chest"]],
                          "decor", 220))
    manifest.update(sheet("heroes_sheet.png", 4, 2,
                          [["knight", "huntress", "runesmith", "sorceress"], [None] * 4],
                          "heroes", 420, max_val=60, max_sat=40))
    rect_crops("heroes_sheet.png", {
        "knight_portrait": (20, 545, 370, 1010),
        "huntress_portrait": (405, 545, 755, 1010),
        "runesmith_portrait": (790, 545, 1140, 1010),
        "sorceress_portrait": (1172, 545, 1522, 1010),
    }, "heroes", 300)
    round_icons("spells_sheet.png", 4, 3, 0, ["fireball", "lightning", "heal", "rage"], "spells", 160)
    glow_fx("spells_sheet.png", 4, 3,
            [[None] * 4,
             ["fx_fireball", "fx_lightning", "fx_heal", "fx_rage"],
             ["fx_freeze", "fx_quake", "fx_invis", "fx_skeletons"]],
            "spells", 300, skip_rows=(0,))
    manifest.update(sheet("walls_sheet.png", 4, 4,
                          [["wall_1", "wall_1c", "wall_2", "wall_2c"],
                           ["wall_3", "wall_3c", "wall_4", "wall_4c"],
                           ["trap_spikes", "trap_bear", "trap_rune", "trap_barrel"],
                           ["rubble_1", "rubble_2", "rubble_3", "rubble_fire"]],
                          "buildings", 240, light=196, max_sat=14))
    manifest.update(sheet("military_sheet.png", 4, 2,
                          [["barracks_1", "heroaltar_1", "builderhut_1", "forge_1"],
                           ["spelltower_1", "guildhall_1", "workshop_1", "tavern_1"]],
                          "buildings", 380, light=196, max_sat=14))
    manifest.update(sheet("troops_sheet.png", 3, 3,
                          [["swordsman", "crossbowman", "shieldbearer"],
                           ["thief", "sapper", "battlemage"],
                           ["priest", "ram", "griffin"]],
                          "troops", 200, light=112, max_sat=9))
    manifest.update(sheet("pads_sheet.png", 4, 2,
                          [["pad_s", "pad_m", "pad_l", "pad_wood"],
                           ["pad_marble", "road", "road_cross", "stairs"]],
                          "pads", 420, light=196, max_sat=14))
    manifest.update(sheet("villagers_sheet.png", 4, 2,
                          [["builder", "peasant", "farmer", "merchant"],
                           ["guard", "monk", "child", "smith"]],
                          "villagers", 200, light=112, max_sat=9))
    manifest.update(sheet("rewards_sheet.png", 4, 2,
                          [["chest_wood", "chest_silver", "chest_gold", "chest_royal"],
                           ["gems_small", "gems_bag", "gold_pile", "bread_basket"]],
                          "rewards", 220, light=150, max_sat=12))
    glow_fx("celebration_fx.png", 4, 2,
            [["fx_levelup", "fx_confetti", "fx_star", "fx_sparkle"],
             ["fx_rays", "fx_arrow", "fx_coins", "fx_magic"]],
            "fx", 320, alpha=True)
    manifest.update(sheet("city_sheet.png", 4, 2,
                          [["plot", "plot_locked", "road", "road_t"],
                           ["road_cross", "gate", "fountain", "market"]],
                          "city", 380, light=196, max_sat=14))
    manifest.update(sheet("plaza.png", 1, 1, [["plaza"]], "city", 900, light=196, max_sat=14))
    ui_kit()
    army_camp_gif()
    backgrounds()
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump({k: list(v) for k, v in manifest.items()}, f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
