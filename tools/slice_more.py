#!/usr/bin/env python3
"""Нарезка листов: снаряжение, арены Башни/Подземелья, боссы, советник, центр бонусов.
Запуск: python3 tools/slice_more.py"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice_ui import extract, fit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source", "realm")
A = os.path.join(ROOT, "client", "assets", "realm")


def save(img, folder, name, side):
    os.makedirs(os.path.join(A, folder), exist_ok=True)
    fit(img, side).save(os.path.join(A, folder, name + ".png"), optimize=True)


# снаряжение: колонки — слоты, ряды — редкость
SLOTS = ["weapon", "helmet", "armor", "gloves", "boots", "amulet"]
RARE = ["common", "uncommon", "rare", "epic", "legendary"]
imgs = extract(os.path.join(SRC, "gear.png"), 30, gap=100, dil=3, glow=True, split=5, holes=True)
for img, nm in zip(imgs, [f"{s}_{r}" for r in RARE for s in SLOTS]):
    save(img, "gear", nm, 160)

# арены: 4 вертикальные панели
im = Image.open(os.path.join(SRC, "arenas_tower.png")).convert("RGB")
w, h = im.size
for i, nm in enumerate(["tower1", "tower2", "dungeon1", "dungeon2"]):
    x0, x1 = round(i * w / 4) + 6, round((i + 1) * w / 4) - 6
    a = im.crop((x0, 0, x1, h))
    k = 1000 / a.size[1]
    a.resize((round(a.size[0] * k), 1000), Image.LANCZOS).save(os.path.join(A, "arenas", nm + ".jpg"), quality=86)

for img, nm in zip(extract(os.path.join(SRC, "bosses.png"), 6, gap=150, dil=3, glow=True, holes=True, grid=(3, 2)),
                   ["troll", "deathknight", "wyvern", "spider", "golem", "morvane"]):
    save(img, "bosses", nm, 700)

for img, nm in zip(extract(os.path.join(SRC, "advisor.png"), 9, gap=150, dil=3, glow=False, split=5),
                   ["advisor", "advisor_bust", "m_repair", "m_tax", "m_diplomacy", "m_research", "m_caravan", "m_drill", "m_feast"]):
    save(img, "advisor", nm, 640 if nm == "advisor" else 420)

for img, nm in zip(extract(os.path.join(SRC, "bonus.png"), 15, gap=120, dil=12, glow=True),
                   ["b_banner", "b_heroine", "b_wheel", "b_pointer", "b_fund", "b_gift", "b_timer",
                    "bt_gift", "bt_crown", "bt_wheel", "bt_chest", "bt_hero", "bt_calendar", "bt_scroll", "bt_star"]):
    save(img, "bonus", nm, 700 if nm in ("b_heroine", "b_banner", "b_wheel") else 300)
print("готово")
