# -*- coding: utf-8 -*-
"""从 act3 敌人表生成「怪物阵营」可招募池、羁绊、首领映射。"""

import json
import os
from collections import Counter, defaultdict

ROOT = r"E:\明日方舟卫戍协议\SP\Stronghold-Protocol"
SRC = os.path.join(ROOT, "data", "versions", "act3autochess-v3_1")
OUT = r"E:\明日方舟卫戍协议\4v4\data"
os.makedirs(OUT, exist_ok=True)

enemies = json.load(open(os.path.join(SRC, "enemies.json"), encoding="utf-8"))
bands = json.load(open(os.path.join(SRC, "bands.json"), encoding="utf-8"))

# ---------- 1. 可招募池 ----------
SKIP_TAGS = set()

BOSSISH = ("假想敌", "帝国的甲胄", "斩胄", "破胄", "碎铳")


def playable(x):
    if x.get("tokenOnly") or x.get("notCountInTotal"):
        return False
    if x.get("rank") not in ("NORMAL", "ELITE", "BOSS"):
        return False
    if not x.get("name"):
        return False
    if any(k in x["name"] for k in BOSSISH):        # 地图首领/装置，不可招募
        return False
    if x.get("rank") == "BOSS":
        return True
    st = x.get("stats") or {}
    hp = st.get("maxHp") or 0
    atk = st.get("atk") or 0
    df = st.get("def") or 0
    mv = st.get("moveSpeed") or 0
    # 可招募怪物的合理区间：会动、有输出、不像 Boss
    if mv <= 0.05:
        return False
    if atk < 100:
        return False
    if not (1200 <= hp <= 45000):
        return False
    if df > 2500:
        return False
    return True

pool = [x for x in enemies.values() if playable(x)]

# 按分级挑选：普通 24 / 精英 24 / 首领 16
def score(x):
    s = 0
    if x.get("tags"):
        s += 3
    if x.get("skills"):
        s += 2
    if x.get("acTypes"):
        s += 1
    st = x.get("stats") or {}
    if st.get("maxHp") and st["maxHp"] >= 1500:
        s += 1
    return s

def pick(rank, n):
    cand = [x for x in pool if x["rank"] == rank]
    cand.sort(key=lambda x: (-score(x), -(x.get("stats") or {}).get("maxHp", 0)))
    out, seen = [], set()
    for x in cand:
        if x["name"] in seen:
            continue
        seen.add(x["name"])
        out.append(x)
        if len(out) >= n:
            break
    return out

def power(u):
    """同一稀有度内的强度评分（血量/攻击/防御/法抗 归一化加权）"""
    st = u.get("stats") or {}
    hp = (st.get("maxHp") or 0) / 1000.0
    atk = (st.get("atk") or 0) / 200.0
    df = (st.get("def") or 0) / 150.0
    res = (st.get("res") or 0) / 20.0
    return hp * 1.0 + atk * 1.2 + df * 0.8 + res * 0.4


def assign_cost(rank_units, low_cost, high_cost):
    """按强度中位数分两档"""
    ranked = sorted(rank_units, key=power)
    mid = len(ranked) // 2
    for u in ranked[:mid]:
        u["_cost"] = low_cost
    for u in ranked[mid:]:
        u["_cost"] = high_cost
    return ranked

normal = assign_cost(pick("NORMAL", 24), 2, 3)
elite = assign_cost(pick("ELITE", 24), 3, 4)
boss = pick("BOSS", 16)          # 首领只作为开局选择，不进商店

STAR_CAP = {"NORMAL": 3, "ELITE": 3, "BOSS": 2}

def to_entry(x, rank, cost):
    st = x.get("stats") or {}
    return {
        "id": x["key"], "name": x["name"], "rank": rank, "cost": cost,
        "starCap": STAR_CAP[rank],
        "tags": x.get("tags") or [], "acTypes": x.get("acTypes") or [],
        "fly": bool(x.get("isFlyEnemy")), "applyWay": x.get("applyWay"),
        "hp": st.get("maxHp"), "atk": st.get("atk"), "def": st.get("def"),
        "res": st.get("res"), "bat": st.get("bat"), "range": st.get("rangeRadius"),
        "block": st.get("blockCnt"), "moveSpeed": st.get("moveSpeed"),
        "dmgType": st.get("dmgType"), "desc": x.get("desc"),
        "skills": len(x.get("skills") or []), "summons": len(x.get("summons") or []),
    }


leaders = [to_entry(x, "BOSS", 0) for x in boss]

units = []
for x in normal + elite:
    st = x.get("stats") or {}
    units.append({
        "id": x["key"],
        "name": x["name"],
        "rank": x["rank"],
        "cost": x["_cost"],
        "starCap": STAR_CAP[x["rank"]],
        "tags": x.get("tags") or [],
        "acTypes": x.get("acTypes") or [],
        "fly": bool(x.get("isFlyEnemy")),
        "applyWay": x.get("applyWay"),
        "hp": st.get("maxHp"),
        "atk": st.get("atk"),
        "def": st.get("def"),
        "res": st.get("res"),
        "bat": st.get("bat"),
        "range": st.get("rangeRadius"),
        "block": st.get("blockCnt"),
        "moveSpeed": st.get("moveSpeed"),
        "dmgType": st.get("dmgType"),
        "desc": x.get("desc"),
        "skills": len(x.get("skills") or []),
        "summons": len(x.get("summons") or []),
    })

# ---------- 2. 怪物羁绊 ----------
TAG_CN = {
    "sarkaz": "萨卡兹", "origen": "源石", "machine": "机械", "drone": "无人机",
    "seamonster": "海兽", "infection": "感染", "originiumartscraft": "源石技艺",
    "mutant": "变异", "collapsal": "坍缩",
}
AC_CN = {
    "SPECIAL": "特异", "CRITIC": "致命", "REBORN": "复苏", "INVISIBLE": "隐匿",
    "ELEMENT": "元素", "REFLECTION": "折射", "FLY": "飞行", "DOT": "持续", "TIMES": "频次",
}

bonds = []
for tag, cn in TAG_CN.items():
    members = [u["id"] for u in units if tag in u["tags"]]
    if len(members) >= 2:
        bonds.append({
            "id": f"mbond_{tag}", "name": cn, "kind": "TAG",
            "members": members, "thresholds": [2, 4, 6],
        })
# 特性羁绊（按 acTypes / 飞行）
for ac, cn in AC_CN.items():
    members = [u["id"] for u in units if ac in u["acTypes"]]
    if len(members) >= 3:
        bonds.append({
            "id": f"mbond_{ac.lower()}", "name": cn, "kind": "TRAIT",
            "members": members, "thresholds": [2, 4],
        })
fly_members = [u["id"] for u in units if u["fly"]]
if len(fly_members) >= 3:
    bonds.append({"id": "mbond_fly_unit", "name": "空援", "kind": "TRAIT",
                  "members": fly_members, "thresholds": [2, 4]})

# ---------- 3. 首领 ↔ 策略 ----------
# 策略 = bands 里带 effectName 的条目
strategies = []
for bid, b in bands.items():
    if b.get("effectName"):
        strategies.append({
            "bandId": bid, "name": b.get("name"),
            "effect": b.get("effectName"), "desc": b.get("desc", "").replace("\n", " / "),
            "totalHp": b.get("totalHp"),
        })

# 按「高耐久/高攻/召唤/控制/机制」给策略打标签，与首领特征匹配
def strategy_kind(s):
    d = (s["desc"] or "") + s["effect"]
    if "生命值" in d or "耐久" in d:
        return "tank"
    if "攻击" in d or "伤害" in d:
        return "dps"
    if "召唤" in d:
        return "summon"
    if "资金" in d or "金币" in d:
        return "econ"
    if "升星" in d or "商店" in d:
        return "shop"
    return "util"


def boss_kind(u):
    st = u
    if u["summons"]:
        return "summon"
    if (u["hp"] or 0) >= 15000 or (u["def"] or 0) >= 600:
        return "tank"
    if (u["atk"] or 0) >= 1500:
        return "dps"
    return "util"

for s in strategies:
    s["kind"] = strategy_kind(s)

by_kind = defaultdict(list)
for b in leaders:
    by_kind[boss_kind(b)].append(b)

boss_map = []
used = set()
for s in strategies:
    cands = [b for b in by_kind.get(s["kind"], []) if b["id"] not in used]
    if not cands:
        cands = [b for b in leaders if b["id"] not in used]
    if not cands:
        continue
    b = cands[0]
    used.add(b["id"])
    boss_map.append({
        "strategy": s["bandId"], "strategyName": s["name"],
        "strategyEffect": s["effect"], "strategyDesc": s["desc"],
        "boss": b["id"], "bossName": b["name"], "bossKind": boss_kind(b),
        "mirrorNote": "怪物方以此首领对应同名策略效果",
    })

json.dump({"units": units}, open(os.path.join(OUT, "units.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump({"bonds": bonds}, open(os.path.join(OUT, "bonds.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump({"leaders": leaders}, open(os.path.join(OUT, "leaders.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

json.dump({"strategies": strategies, "mapping": boss_map},
          open(os.path.join(OUT, "boss_map.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

print(f"单位 {len(units)}（普通{len(normal)} 精英{len(elite)} 首领{len(boss)}）")
print(f"羁绊 {len(bonds)}：{[b['name'] for b in bonds]}")
print(f"策略 {len(strategies)} | 首领映射 {len(boss_map)}")
from collections import Counter as _C
print("费用分布:", dict(_C(f"{u['rank']}-{u['cost']}费" for u in units)))
for c in (2, 3, 4):
    ex = [f"{u['name']}({u['rank'][0]})" for u in units if u['cost'] == c][:5]
    print(f"  {c} 费样例:", "、".join(ex))
