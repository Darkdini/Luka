#!/usr/bin/env python3
"""Нарезка листа предметов (art/source/realm/items.png) -> client/assets/realm/items/."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice_ui import extract, fit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "client", "assets", "realm", "items")
NAMES = ["sp1", "sp2", "sp3", "sp4", "sp5", "sp6",
         "spb", "spt", "spr", "sph", "spm", "spg",
         "rc_food", "rc_wood", "rc_stone", "rc_iron", "rc_mana", "rc_gold",
         "sh1", "sh2", "sh3", "tp1", "tp2", "peace",
         "bo_atk", "bo_def", "bo_res", "potion", "bo_march", "bag"]

os.makedirs(OUT, exist_ok=True)
imgs = extract(os.path.join(ROOT, "art", "source", "realm", "items.png"), len(NAMES), gap=100, dil=3, glow=True, split=5)
for img, nm in zip(imgs, NAMES):
    fit(img, 160).save(os.path.join(OUT, nm + ".png"), optimize=True)
print("готово:", OUT, len(imgs))
