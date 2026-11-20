#!/usr/bin/env python3
"""Нарезка листов союзов, технологий, VIP, пропуска и витрины -> client/assets/realm/meta/.
Запуск: python3 tools/slice_meta.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice_ui import extract, fit  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art", "source", "realm")
OUT = os.path.join(ROOT, "client", "assets", "realm", "meta")

SHEETS = [
    ("ally_buildings.png", ["a_hall", "a_treasury", "a_tent", "a_fort1", "a_fort2", "a_fort3", "a_burned", "a_rally"], 360, dict(gap=120, dil=3, glow=False, grid=(4, 2), holes=False)),
    ("ally_crests.png", ["sh_heater", "sh_round", "sh_kite", "sh_square", "sh_banner", "sh_gothic"]
     + ["c_" + n for n in ["lion", "eagle", "wolf", "bear", "dragon", "stag", "raven", "boar", "serpent", "tower", "crown", "swords",
                           "axe", "hammer", "oak", "sun", "moon", "star"]], 160, dict(gap=100, dil=3, glow=False, split=6)),
    ("ally_icons.png", ["ai_members", "ai_leader", "ai_officer", "ai_member", "ai_recruit",
                        "ai_help", "ai_helped", "ai_gift", "ai_shop", "ai_tech",
                        "ai_chat", "ai_invite", "ai_request", "ai_leave", "ai_kick",
                        "ai_war", "ai_rally", "ai_territory", "ai_rank", "ai_diplomacy"], 128, dict(gap=100, dil=3, glow=False, split=6)),
    ("tech_icons.png", ["t_farm", "t_wood", "t_stone", "t_iron", "t_mana", "t_gold",
                        "t_wagon", "t_build", "t_atk", "t_def", "t_armor", "t_bow",
                        "t_lance", "t_drum", "t_heal", "t_march", "t_book", "t_statue",
                        "t_rune", "t_banner", "t_scout", "t_tower", "t_wall", "t_crown", "t_time"], 140, dict(gap=100, dil=3, glow=False, split=6)),
    ("vip_rewards.png", [f"vip{i}" for i in range(1, 11)]
     + ["ch_wood", "ch_iron", "ch_silver", "ch_gold", "ch_royal", "ch_mythic", "ch_hero", "ch_res"]
     + ["gems1", "gems2", "gems3", "gems4"], 220, dict(gap=110, dil=3, glow=True, split=5)),
    ("pass_ui.png", ["p_track", "p_gold", "p_free", "p_locked", "p_claimed", "p_banner", "p_timer",
                     "p_cal", "p_cal_today", "p_scroll", "p_trophy", "p_podium"], 900, dict(gap=110, dil=3, glow=True, split=5)),
    ("event_ui.png", ["e_hunt", "e_build", "e_gather", "e_muster", "e_gold", "e_silver", "e_bronze", "e_wreath", "e_plate", "e_points", "e_post", "e_chest"], 640, dict(gap=110, dil=3, glow=True, split=5)),
    ("offers.png", ["o_starter", "o_builder", "o_hero", "o_army", "o_month", "o_gems"], 420, dict(gap=150, dil=3, glow=False, grid=(3, 2))),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    for sheet, names, side, kw in SHEETS:
        imgs = extract(os.path.join(SRC, sheet), len(names), **kw)
        for img, nm in zip(imgs, names):
            fit(img, side).save(os.path.join(OUT, nm + ".png"), optimize=True)
    print("готово:", OUT)


if __name__ == "__main__":
    main()
