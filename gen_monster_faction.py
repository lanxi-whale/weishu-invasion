# -*- coding: utf-8 -*-
"""怪物阵营数据生成（V2）

羁绊分两层：
  主羁绊（MAIN）  阵营：炎 / 海嗣 / 源石虫 / 萨卡兹·王庭 / 萨卡兹·枯朽
                        整合运动 / 无人机 / 巫王乐团 / 残党乐团 / 感染 / 深池(保留)
  副羁绊（SUB）   战术特性：特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射 / 致命 / 复苏

规则：
  1. 一个怪物最多同时属于 3 个主羁绊
  2. 星级上限 2 星；残党乐团 / 巫王乐团 不再作为上下级（升星）关系
  3. 费用：普通 2/3 费，精英 3/4 费，按池内强度中位数分档
  4. 每个主羁绊保底取 quota 个最强成员，剩余按强度补满
"""

import json
import os
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = r"E:\明日方舟卫戍协议\SP\Stronghold-Protocol"
SRC = os.path.join(ROOT, "data", "versions", "act3autochess-v3_1")
OUT = Path(__file__).resolve().parent / "data"
os.makedirs(OUT, exist_ok=True)

from rules import (
    _match, AC_CN, BOND_EXCLUSIONS, BOND_INCLUSIONS, BOSSISH, power, playable, nm, tags, acs,
    MAIN_BONDS, MINOR_BONDS, SUB_BONDS,
    NAME_OF_MAIN, NAME_OF_MINOR, NAME_OF_SUB,
    main_keys_of, minor_keys_of, sub_keys_of, invasion_star_stats,
)


def apply_bond_overrides():
    documents = {name: json.loads((OUT / f"{name}.json").read_text("utf-8")) for name in ("units", "bonds", "summary")}
    units, catalog = documents["units"]["units"], documents["bonds"]
    affected_bonds = BOND_EXCLUSIONS.keys() | BOND_INCLUSIONS.keys()
    for section, keys_field, names_field, names in (
        ("main", "bondKeys", "factions", NAME_OF_MAIN),
        ("sub", "subKeys", "subs", NAME_OF_SUB),
    ):
        for unit in units:
            keys = unit[keys_field]
            unit_id = unit["id"]
            revised = [key for key in keys if unit_id not in BOND_EXCLUSIONS.get(key, ())]
            revised.extend(key for key in names if key not in revised and unit_id in BOND_INCLUSIONS.get(key, ()))
            if revised == keys:
                continue
            unit[keys_field] = revised
            unit[names_field] = [names[key] for key in revised]
            if section == "main":
                unit["faction"] = names[revised[0]] if revised else "无阵营"
        for bond in catalog[section] + catalog["bonds"]:
            key = bond["key"]
            if bond["kind"] != section.upper() or key not in affected_bonds:
                continue
            bond["members"] = [unit["id"] for unit in units if key in unit[keys_field]]
            bond["memberCount"] = len(bond["members"])
            bond["pending"] = bond["memberCount"] < bond["thresholds"][0]
    documents["summary"]["faction"] = dict(Counter(unit["faction"] for unit in units))
    for name, document in documents.items():
        (OUT / f"{name}.json").write_text(json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8")


if "--apply-bond-overrides" in sys.argv or "--apply-bond-exclusions" in sys.argv:
    apply_bond_overrides()
    sys.exit(0)

enemies = json.load(open(os.path.join(SRC, "enemies.json"), encoding="utf-8"))
bands = json.load(open(os.path.join(SRC, "bands.json"), encoding="utf-8"))

POOL_SIZE = 240
MAX_MAIN_PER_UNIT = 3
RANK_CAP = {"NORMAL": 56, "ELITE": 52}
STAR_CAP = {"NORMAL": 2, "ELITE": 2, "BOSS": 2}
TARGET_NORMAL = 52

# ---------------------------------------------------------------- 升星映射
# 残党乐团 ↔ 巫王乐团 带 _2 后缀，但不作为上下级，拆成两个独立阵营
STAR_MAP = {}
for k in enemies:
    m = re.match(r"^(.*)_([23])$", k)
    if not m or m.group(1) not in enemies:
        continue
    base, var = enemies[m.group(1)], enemies[k]
    bn, vn = base.get("name") or "", var.get("name") or ""
    if ("残党" in bn and "巫王" in vn) or ("巫王" in bn and "残党" in vn):
        continue
    STAR_MAP.setdefault(m.group(1), {1: m.group(1)})[int(m.group(2))] = k
for base, forms in STAR_MAP.items():
    forms.setdefault(1, base)

VARIANT_IDS = {f for d in STAR_MAP.values() for st, f in d.items() if st > 1}

# ---------------------------------------------------------------- 选池
# 小羁绊成员一律入池：即使防御超 2500、攻击为 0、或是召唤单位
FORCED = {x["key"] for x in enemies.values()
          if x.get("rank") != "BOSS" and (minor_keys_of(x) or main_keys_of(x))}

cand = [x for x in enemies.values()
        if (playable(x) or x["key"] in FORCED)
        and x.get("rank") != "BOSS" and x["key"] not in VARIANT_IDS]

picked, picked_ids = [], set()


def add(x):
    if x["key"] in picked_ids:
        return
    picked.append(x)
    picked_ids.add(x["key"])


def take(group, quota):
    got = 0
    for x in sorted(group, key=lambda y: -power(y)):
        if got >= quota:
            break
        if x["key"] in picked_ids:
            got += 1
            continue
        if rank_count(x["rank"]) >= RANK_CAP[x["rank"]]:
            continue
        picked.append(x)
        picked_ids.add(x["key"])
        got += 1


def main_group(key):
    return [x for x in cand if key in main_keys_of(x)]


def sub_group(key):
    return [x for x in cand if key in sub_keys_of(x)]


def minor_group(key):
    return [x for x in cand if key in minor_keys_of(x)]


# ① 主羁绊：池内补满，单个超过 10 人则随机剔除到 10
for key, name, fn, quota, note in MAIN_BONDS:
    for x in [x for x in cand if _match(name, fn, x)]:
        add(x)

# ② 小羁绊：全部成员入池
for key, name, fn, note in MINOR_BONDS:
    for x in [x for x in cand if _match(name, fn, x)]:
        add(x)

# ③ 副羁绊：每个补 3 人
for key, name, fn in SUB_BONDS:
    rest = sorted([x for x in cand if key in sub_keys_of(x) and x["key"] not in picked_ids],
                  key=lambda y: -power(y))
    for x in rest[:3]:
        add(x)

# ④ 不足 POOL_SIZE 时按强度补齐
if len(picked) < POOL_SIZE:
    rest = sorted([x for x in cand if x["key"] not in picked_ids], key=lambda y: -power(y))
    for x in rest[:POOL_SIZE - len(picked)]:
        add(x)


# ---------------------------------------------------------------- 费用
def assign_cost(units_of_rank, low, high):
    ranked = sorted(units_of_rank, key=power)
    mid = len(ranked) // 2
    for u in ranked[:mid]:
        u["_cost"] = low
    for u in ranked[mid:]:
        u["_cost"] = high


assign_cost([x for x in picked if x["rank"] == "NORMAL"], 2, 3)
assign_cost([x for x in picked if x["rank"] == "ELITE"], 3, 4)


# ---------------------------------------------------------------- 输出单位
def to_entry(x):
    st = invasion_star_stats(x, enemies)
    mkeys = main_keys_of(x)
    skeys = sub_keys_of(x)
    forms = STAR_MAP.get(x["key"])
    stars = []
    if forms:
        for tier in (1, 2):
            vid = forms.get(tier)
            if not vid:
                continue
            v = enemies[vid]
            vs = invasion_star_stats(v, enemies)
            stars.append({"star": tier, "id": vid, "name": v.get("name"),
                          "hp": vs.get("maxHp"), "atk": vs.get("atk"),
                          "def": vs.get("def"), "res": vs.get("res"),
                          "bat": vs.get("bat"), "range": vs.get("rangeRadius")})
    base_hp, base_atk = st.get("maxHp") or 0, st.get("atk") or 0
    base_def, base_res = st.get("def") or 0, st.get("res") or 0
    have = {s["star"] for s in stars} if stars else {1}
    if not stars:
        stars = [{"star": 1, "id": x["key"], "name": x["name"],
                  "hp": base_hp, "atk": base_atk, "def": base_def, "res": base_res,
                  "bat": st.get("bat"), "range": st.get("rangeRadius")}]
    if 2 not in have:
        k = 1.6
        stars.append({"star": 2, "id": f'{x["key"]}@s2', "name": x["name"],
                      "hp": int(base_hp * k), "atk": int(base_atk * k),
                      "def": int(base_def * k), "res": base_res,
                      "bat": st.get("bat"), "range": st.get("rangeRadius"),
                      "synthetic": True})
    stars.sort(key=lambda s: s["star"])
    return {
        "id": x["key"], "name": x["name"], "rank": x["rank"],
        "stars": stars,
        "cost": x.get("_cost", 0), "starCap": STAR_CAP[x["rank"]],
        "tags": tags(x), "acTypes": acs(x),
        "factions": [NAME_OF_MAIN[k] for k in mkeys],
        "minors": [NAME_OF_MINOR[k] for k in minor_keys_of(x)],
        "minorKeys": minor_keys_of(x),
        "bondKeys": mkeys,
        "subs": [NAME_OF_SUB[k] for k in skeys],
        "subKeys": skeys,
        "faction": NAME_OF_MAIN[mkeys[0]] if mkeys else "无阵营",
        "forced": not playable(x),
        "fly": bool(x.get("isFlyEnemy")), "applyWay": x.get("applyWay"),
        "hp": st.get("maxHp"), "atk": st.get("atk"), "def": st.get("def"),
        "res": st.get("res"), "bat": st.get("bat"), "range": st.get("rangeRadius"),
        "block": st.get("blockCnt"), "moveSpeed": st.get("moveSpeed"),
        "dmgType": st.get("dmgType"), "desc": x.get("desc"),
        "skills": len(x.get("skills") or []), "summons": len(x.get("summons") or []),
    }


units = [to_entry(x) for x in picked]


# ---------------------------------------------------------------- 羁绊
# 羁绊层数门槛：主 4/7，小 2，副 3/6
TIERS = {"MAIN": [4, 7], "MINOR": [2], "SUB": [3, 6]}


def thresholds(n, kind):
    if kind == "MINOR":
        # 小羁绊：2 人起效；人数够 4 的再加一档
        return [2, 4] if n >= 4 else [2]
    return list(TIERS[kind])


bonds = []
for key, name, fn, quota, note in MAIN_BONDS:
    members = [u["id"] for u in units if key in u["bondKeys"]]
    bonds.append({
        "id": f"main_{key}", "key": key, "name": name, "kind": "MAIN",
        "members": members, "memberCount": len(members),
        "thresholds": thresholds(len(members), "MAIN"),
        "pending": len(members) < TIERS["MAIN"][0], "note": note,
    })

for key, name, fn, note in MINOR_BONDS:
    members = [u["id"] for u in units if key in u.get("minorKeys", [])]
    n = len(members)
    bonds.append({
        "id": f"minor_{key}", "key": key, "name": name, "kind": "MINOR",
        "members": members, "memberCount": n,
        "thresholds": thresholds(n, "MINOR"),
        "pending": n < TIERS["MINOR"][0], "note": note,
    })

for key, name, fn in SUB_BONDS:
    members = [u["id"] for u in units if key in u["subKeys"]]
    bonds.append({
        "id": f"sub_{key.lower()}", "key": key, "name": name, "kind": "SUB",
        "members": members, "memberCount": len(members),
        "thresholds": thresholds(len(members), "SUB"),
        "pending": len(members) < TIERS["SUB"][0], "note": "",
    })

# ---------------------------------------------------------------- 首领
leaders_raw = sorted([x for x in enemies.values() if playable(x) and x.get("rank") == "BOSS"],
                     key=lambda x: -power(x))[:16]
leaders = [to_entry(x) for x in leaders_raw]

strategies = []
for bid, b in bands.items():
    if b.get("effectName"):
        strategies.append({
            "bandId": bid, "name": b.get("name"), "effect": b.get("effectName"),
            "desc": (b.get("desc") or "").replace("\n", " / "), "totalHp": b.get("totalHp"),
        })


def strategy_kind(s):
    d = (s["desc"] or "") + s["effect"]
    if "生命值" in d or "耐久" in d:
        return "tank"
    if "召唤" in d:
        return "summon"
    if "资金" in d or "金币" in d:
        return "econ"
    if "攻击" in d or "伤害" in d:
        return "dps"
    return "util"


def boss_kind(b):
    if b["summons"]:
        return "summon"
    if (b["hp"] or 0) >= 15000 or (b["def"] or 0) >= 600:
        return "tank"
    if (b["atk"] or 0) >= 1500:
        return "dps"
    return "util"


by_kind = defaultdict(list)
for b in leaders:
    by_kind[boss_kind(b)].append(b)
for s in strategies:
    s["kind"] = strategy_kind(s)

mapping, used = [], set()
for s in strategies:
    pool = [b for b in by_kind.get(s["kind"], []) if b["id"] not in used]
    if not pool:
        pool = [b for b in leaders if b["id"] not in used]
    if not pool:
        continue
    b = pool[0]
    used.add(b["id"])
    mapping.append({"strategy": s["bandId"], "strategyName": s["name"],
                    "strategyEffect": s["effect"], "strategyDesc": s["desc"],
                    "boss": b["id"], "bossName": b["name"], "bossKind": boss_kind(b)})

json.dump({"units": units}, open(os.path.join(OUT, "units.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump({"bonds": bonds,
           "main": [b for b in bonds if b["kind"] == "MAIN"],
           "minor": [b for b in bonds if b["kind"] == "MINOR"],
           "sub": [b for b in bonds if b["kind"] == "SUB"]},
          open(os.path.join(OUT, "bonds.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump({"leaders": leaders}, open(os.path.join(OUT, "leaders.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump({"strategies": strategies, "mapping": mapping},
          open(os.path.join(OUT, "boss_map.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump({"mainPick": 6, "minorPick": 6, "mainCap": 10,
           "note": "每局从主/小羁绊中各随机 6 组，未选中的羁绊怪物不进入商店；主羁绊成员已在数据层封顶 10 人"},
          open(os.path.join(OUT, "match_rules.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

json.dump({"total": len(units), "cost": dict(Counter(u["cost"] for u in units)),
           "rank": dict(Counter(u["rank"] for u in units)),
           "faction": dict(Counter(u["faction"] for u in units))},
          open(os.path.join(OUT, "summary.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

print(f"招募池 {len(units)}（普通 {sum(1 for u in units if u['rank']=='NORMAL')} / "
      f"精英 {sum(1 for u in units if u['rank']=='ELITE')}）")
print("费用:", dict(sorted(Counter(u["cost"] for u in units).items())))
print("\n主羁绊:")
for b in bonds:
    if b["kind"] != "MAIN":
        continue
    flag = "  ← 待补" if b["pending"] else ""
    print(f"  {b['name']:8} {b['memberCount']:2} 人  {b['thresholds']}{flag}")
print("\n小羁绊:")
for b in bonds:
    if b["kind"] == "MINOR":
        flag = "  ← 待补" if b["pending"] else ""
        print(f"  {b['name']:6} {b['memberCount']:2} 人  {b['thresholds']}{flag}")

print("\n副羁绊:")
for b in bonds:
    if b["kind"] == "SUB":
        print(f"  {b['name']:4} {b['memberCount']:2} 人  {b['thresholds']}")
print(f"\n首领 {len(leaders)} | 策略映射 {len(mapping)}")
