#!/usr/bin/env python3
"""Нарезка листов войск (art/source/realm/troops_*.png) -> client/assets/realm/troops/.
Войска: по расе 12 фигур — ряды: пехота, стрелки, кавалерия; столбцы — ступени I–II, III–IV, V–VI, VII–VIII.
Интерфейс: медали ступеней I–VIII, значки родов войск, раненые, лечение, очередь, лагерь, рамки карточек.
Запуск: python3 tools/slice_troops.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice_ui import extract, fit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source", "realm")
OUT = os.path.join(ROOT, "client", "assets", "realm", "troops")

UI = ["tier1", "tier2", "tier3", "tier4", "tier5", "tier6", "tier7", "tier8",
      "type_infantry", "type_archer", "type_cavalry",
      "wounded", "heal", "queue", "camp", "card", "card_on"]


def main():
    os.makedirs(OUT, exist_ok=True)
    for race in ["humans", "elves", "dwarves", "orcs"]:
        names = [f"{race}_{t}{g}" for t in ["infantry", "archer", "cavalry"] for g in range(1, 5)]
        imgs = extract(os.path.join(SRC, f"troops_{race}.png"), len(names), gap=150, dil=3, glow=False, split=6, holes=True)
        for img, nm in zip(imgs, names):
            fit(img, 520).save(os.path.join(OUT, nm + ".png"), optimize=True)
    imgs = extract(os.path.join(SRC, "troops_ui.png"), len(UI), gap=80, dil=2, glow=False, split=5)
    for img, nm in zip(imgs, UI):
        fit(img, 300 if nm.startswith("card") else 128).save(os.path.join(OUT, nm + ".png"), optimize=True)
    print("готово:", OUT)


if __name__ == "__main__":
    main()
