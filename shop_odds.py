# -*- coding: utf-8 -*-
"""商店概率模拟：按本局启用的羁绊、卡池副本、回合限制，算出各商店等级的出货概率

用法：
    python shop_odds.py            # 随机一局
    python shop_odds.py 20261114   # 指定种子
"""

import json
import os
import sys
from collections import Counter

import roll_match

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")

SHOP = json.load(open(os.path.join(DATA, "shop_rules.json"), encoding="utf-8"))
UNITS = {u["id"]: u for u in json.load(open(os.path.join(DATA, "units.json"), encoding="utf-8"))["units"]}

COPIES = {int(k): v for k, v in SHOP["poolCopies"].items()}
CAP = {int(k): v for k, v in SHOP["tierCapByLevel"].items()}
ELITE_MIN = SHOP.get("availability", {}).get("eliteMinRound", 1)
LEVELS = SHOP["maxShopLevel"]


def odds(ids, round_no):
    """{level: {cost: 概率}}；前 ELITE_MIN-1 回合过滤精英，该档无货则自动降档"""
    allow_elite = round_no >= ELITE_MIN
    out = {}
    for lv in range(1, LEVELS + 1):
        cap = CAP[lv]
        avail = {}
        while cap >= 2:
            cnt = Counter()
            for i in ids:
                u = UNITS.get(i)
                if not u or u["cost"] > cap:
                    continue
                if not allow_elite and u["rank"] != "NORMAL":
                    continue
                cnt[u["cost"]] += 1
            avail = {k: v * COPIES.get(k, 0) for k, v in cnt.items()}
            if avail:
                break
            cap -= 1
        total = sum(avail.values())
        out[lv] = {k: (v / total if total else 0) for k, v in sorted(avail.items())}
    return out


def show(ids, title, round_no):
    print(f"\n{title}")
    print("等级 | 可刷 | 部署位 | 2费 | 3费 | 4费")
    print("---|---|---|---|---")
    for lv, row in odds(ids, round_no).items():
        cells = " | ".join(f"{row.get(k, 0) * 100:.0f}%" for k in (2, 3, 4))
        print(f"{lv} | ≤{CAP[lv]}费 | {SHOP['deploy']['byLevel'][str(lv)]} | {cells}")


if __name__ == "__main__":
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else None
    mains, minors, ids = roll_match.roll(seed)
    cnt = Counter(UNITS[i]["cost"] for i in ids if i in UNITS)
    elite = sum(1 for i in ids if UNITS[i]["rank"] == "ELITE")

    print("本局启用：主 " + "、".join(b["name"] for b in mains)
          + " ｜ 小 " + "、".join(b["name"] for b in minors))
    print(f"可用棋子 {len(ids)} 个（普通 {len(ids)-elite} / 精英 {elite}），按费用："
          + "、".join(f"{k}费{v}个" for k, v in sorted(cnt.items())))

    show(ids, f"=== 第 1~{ELITE_MIN-1} 回合（不刷精英）===", 1)
    show(ids, f"=== 第 {ELITE_MIN} 回合起（精英解禁）===", ELITE_MIN)
