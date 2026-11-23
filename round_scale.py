# -*- coding: utf-8 -*-
"""回合数值成长预览

用法：
    python round_scale.py             # 打印 14 回合倍率表
    python round_scale.py 萨卡兹枯朽战士   # 查看指定单位每回合的生命、攻击和防御
"""

import json
import math
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(BASE, "data", "round_scaling.json"), encoding="utf-8"))
UNITS = json.load(open(os.path.join(BASE, "data", "units.json"), encoding="utf-8"))["units"]


if __name__ == "__main__":
    rounds = range(1, DATA["rounds"] + 1)
    if len(sys.argv) > 1:
        key = sys.argv[1]
        u = next((x for x in UNITS if key in x["name"]), None)
        if not u:
            print("卡池里没有这个名字")
            raise SystemExit
        print(f'{u["name"]}（{u["cost"]} 费，{u["rank"]}）')
        print("回合 | 生命 | 攻击 | 防御")
        print("---|---|---|---")
        for r in rounds:
            factors = DATA["curve"][str(r)]
            hp = math.floor(u["hp"] * factors["maxHp"] + 0.5)
            atk = math.floor(u["atk"] * factors["atk"] + 0.5)
            defense = math.floor((u["def"] or 0) * factors["def"] + 0.5)
            print(f"{r} | {hp:,} | {atk:,} | {defense:,}")
    else:
        print("回合 | 累计攻击倍率 | 累计生命倍率 | 防御倍率")
        print("---|---|---|---")
        for r in rounds:
            factors = DATA["curve"][str(r)]
            print(f'{r} | {factors["atk"]:g}× | {factors["maxHp"]:g}× | {factors["def"]:g}×')
