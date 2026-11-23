# -*- coding: utf-8 -*-
"""对局羁绊抽取：每局随机 6 主 + 6 小，其余羁绊的怪物不进入商店

用法：
    python roll_match.py            # 随机种子
    python roll_match.py 12345      # 指定种子，可复现
"""

import json
import os
import random
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")

RULES = json.load(open(os.path.join(DATA, "match_rules.json"), encoding="utf-8"))
BONDS = json.load(open(os.path.join(DATA, "bonds.json"), encoding="utf-8"))["bonds"]
UNITS = {u["id"]: u for u in json.load(open(os.path.join(DATA, "units.json"), encoding="utf-8"))["units"]}


def roll(seed=None):
    """返回本局启用的主/小羁绊，以及可用棋子"""
    rng = random.Random(seed)
    # 只有人数够 2 人的羁绊才会进入抽签（1 人的雪怪暂时停用）
    mains = [b for b in BONDS if b["kind"] == "MAIN" and b["thresholds"]]
    minors = [b for b in BONDS if b["kind"] == "MINOR" and b["thresholds"]]

    pick_main = rng.sample(mains, min(RULES["mainPick"], len(mains)))
    pick_minor = rng.sample(minors, min(RULES["minorPick"], len(minors)))

    active_ids = set()
    cap = RULES.get("mainCap", 10)
    for b in pick_main:
        ids = list(b["members"])
        if len(ids) > cap:
            ids = rng.sample(ids, cap)      # 超 10 人随机剔除
        active_ids.update(ids)
    for b in pick_minor:
        active_ids.update(b["members"])

    # 只保留仍在卡池里的（会员表已按 10 人封顶）
    active_ids &= set(UNITS)
    return pick_main, pick_minor, sorted(active_ids)


if __name__ == "__main__":
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else random.randrange(1 << 30)
    mains, minors, ids = roll(seed)

    print(f"种子 {seed}")
    keep = {}
    for b in mains:
        keep[b["name"]] = min(b["memberCount"], RULES.get("mainCap", 10))
    print(f"主羁绊 {len(mains)}： " + "、".join(f"{b['name']}({b['memberCount']}→{keep[b['name']]})" for b in mains))
    print(f"小羁绊 {len(minors)}： " + "、".join(f"{b['name']}({b['memberCount']})" for b in minors))

    from collections import Counter
    cost = Counter(UNITS[i]["cost"] for i in ids)
    rank = Counter(UNITS[i]["rank"] for i in ids)
    print(f"可用棋子 {len(ids)} 个 | 2费 {cost[2]} 3费 {cost[3]} 4费 {cost[4]} | "
          f"普通 {rank['NORMAL']} 精英 {rank['ELITE']}")
