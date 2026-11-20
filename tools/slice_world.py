#!/usr/bin/env python3
"""Нарезка листов карты мира (art/source/realm/world_*.png) -> client/assets/realm/world/.
Запуск: python3 tools/slice_world.py"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice_ui import extract, fit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source", "realm")
OUT = os.path.join(ROOT, "client", "assets", "realm", "world")

LAND = ["tex_meadow", "tex_steppe", "tex_snow", "tex_forest",
        "d_pines", "d_autumn", "d_hill", "d_mount",
        "d_boulders", "d_road", "d_ford", "d_tower",
        "d_stones", "d_village"]
SITES = ["s_food", "s_wood", "s_stone", "s_iron", "s_mana", "s_gold",
         "s_bandits", "s_raiders", "s_lair", "s_tower", "s_fortress", "s_city"]
MARCH = [f"m_{k}_{r}" for k in ["army", "scout", "gather"] for r in ["humans", "elves", "dwarves", "orcs"]]
ICONS = ["i_attack", "i_gather", "i_scout", "i_return", "i_rally",
         "i_reinforce", "i_speed", "i_recall", "i_bookmark", "i_coords",
         "i_castle", "i_alliance", "i_allyfort", "i_monster", "i_bandits",
         "i_energy", "i_teleport", "i_peace", "i_report", "i_kingdom"]


def main():
    os.makedirs(OUT, exist_ok=True)
    man = {}
    imgs = extract(os.path.join(SRC, "world_land.png"), len(LAND), gap=120, dil=3, glow=False)
    for img, nm in zip(imgs, LAND):
        if nm.startswith("tex_"):
            im = img.convert("RGB")
            im = im.crop((6, 6, im.size[0] - 6, im.size[1] - 6)).resize((256, 256), Image.LANCZOS)
            im.save(os.path.join(OUT, nm + ".jpg"), quality=86)
            continue
        img = fit(img, 420)
        img.save(os.path.join(OUT, nm + ".png"), optimize=True)
        man[nm] = [img.size[0], img.size[1]]
    for sheet, names, side in (("world_sites.png", SITES, 360), ("world_marches.png", MARCH, 260)):
        if sheet == "world_marches.png":
            imgs = extract(os.path.join(SRC, sheet), len(names), gap=120, dil=2, glow=False, holes=True, grid=(4, 3))
        else:
            imgs = extract(os.path.join(SRC, sheet), len(names), gap=120, dil=3, glow=False, split=6)
        for img, nm in zip(imgs, names):
            img = fit(img, side)
            img.save(os.path.join(OUT, nm + ".png"), optimize=True)
            man[nm] = [img.size[0], img.size[1]]
    imgs = extract(os.path.join(SRC, "world_icons.png"), len(ICONS), gap=100, dil=3, glow=False, split=6)
    for img, nm in zip(imgs, ICONS):
        fit(img, 128).save(os.path.join(OUT, nm + ".png"), optimize=True)
    json.dump(man, open(os.path.join(OUT, "manifest.json"), "w"))
    print("готово:", OUT)


if __name__ == "__main__":
    main()
