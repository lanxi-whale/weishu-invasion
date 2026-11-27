# -*- coding: utf-8 -*-
"""生成怪物图鉴数据（主羁绊=阵营，副羁绊=战术特性）"""

import json
from pathlib import Path

from rules import (MAIN_BONDS, MINOR_BONDS, SUB_BONDS, factions_of, minors_of, subs_of,
                   invasion_star_stats, native_star_base)

ROOT = Path(__file__).resolve().parent
VERSION = ROOT / "game" / "data" / "versions" / "act3autochess-v3_1"
CATALOGUE = ROOT / "怪物图鉴"

TAG_CN = {
    "sarkaz": "萨卡兹", "origen": "源石", "machine": "机械", "drone": "无人机",
    "seamonster": "海嗣", "infection": "感染", "originiumartscraft": "源石技艺",
    "mutant": "变异", "collapsal": "坍缩", "animated": "构造体",
}

enemies = json.loads((VERSION / "enemies.json").read_text(encoding="utf-8"))
chess = json.loads((VERSION / "chess.json").read_text(encoding="utf-8"))
icons = {path.name for path in (CATALOGUE / "icons").glob("*.png")}

pool = {}
try:
    for u in json.loads((ROOT / "data" / "units.json").read_text(encoding="utf-8"))["units"]:
        pool[u["id"]] = u
        for st in (u.get("stars") or []):
            if st["star"] > 1 and not st.get("synthetic"):
                pool.setdefault(st["id"], u)
except Exception:
    pass

items = []
for x in enemies.values():
    st = invasion_star_stats(x, enemies)
    name = x.get("name") or ""
    key = x.get("key") or ""
    facs = factions_of(x)
    subs = subs_of(x)
    tags = [TAG_CN.get(t, t) for t in (x.get("tags") or [])]
    pu = pool.get(key) or {}
    card = chess.get("chess_mon_" + pu.get("id", ""), {})
    variant_of, variant_star = native_star_base(key, enemies) or (None, 0)

    items.append({
        "id": key,
        "name": name or "未命名",
        "rank": x.get("rank"),
        "factions": facs,
        "factionName": facs[0] if facs else "无阵营",
        "faction": facs[0] if facs else "",
        "minors": minors_of(x),
        "subs": subs,
        "tags": tags,
        "ac": subs,
        "hidden": "INVISIBLE" in (x.get("acTypes") or []) or "隐" in name,
        "hp": st.get("maxHp"),
        "atk": st.get("atk"),
        "def": st.get("def"),
        "res": st.get("res"),
        "bat": st.get("bat"),
        "range": st.get("rangeRadius"),
        "block": st.get("blockCnt"),
        "speed": st.get("moveSpeed"),
        "way": {"MELEE": "近战", "RANGED": "远程", "ALL": "全能", "NONE": "无攻击"}.get(x.get("applyWay"), "—"),
        "fly": bool(x.get("isFlyEnemy")),
        "skills": len(x.get("skills") or []),
        "summons": len(x.get("summons") or []),
        "desc": x.get("desc") or "",
        "icon": f"icons/{key}.png" if f"{key}.png" in icons else "",
        "stars": [{"star": s["star"], "name": s["name"], "hp": s["hp"], "atk": s["atk"],
                   "synthetic": bool(s.get("synthetic"))} for s in (pu.get("stars") or [])],
        "variantOf": variant_of,
        "variantStar": variant_star,
        "recruit": key in pool,
        "cost": card.get("price", pu.get("cost", 0)),
        **({"tier": card["tier"]} if card else {}),
    })

rank_weight = {"BOSS": 0, "ELITE": 1, "NORMAL": 2}


def sort_members(ms):
    return sorted(ms, key=lambda i: (rank_weight.get(i["rank"], 9), -(i["hp"] or 0)))


groups = []
for key, name, _fn, _q, _note in MAIN_BONDS:
    members = sort_members([i for i in items if name in i["factions"]])
    if not members and name != "炎":
        continue
    visible = sum(1 for i in members if not i["variantOf"])
    groups.append({"key": key, "name": name, "count": visible, "items": members})

none = sort_members([i for i in items if not i["factions"]])
if none:
    groups.append({"key": "none", "name": "无阵营",
                   "count": sum(1 for i in none if not i["variantOf"]), "items": none})

payload = {
    "total": len(items),
    "counts": {
        "BOSS": sum(1 for i in items if i["rank"] == "BOSS"),
        "ELITE": sum(1 for i in items if i["rank"] == "ELITE"),
        "NORMAL": sum(1 for i in items if i["rank"] == "NORMAL"),
    },
    "mainBonds": [{"key": k, "name": n} for k, n, *_ in MAIN_BONDS],
    "minorBonds": [{"key": k, "name": n} for k, n, _f, _r in MINOR_BONDS],
    "subBonds": [{"key": k, "name": n} for k, n, _f in SUB_BONDS],
    "groups": groups,
}

with (CATALOGUE / "data.js").open("w", encoding="utf-8") as f:
    f.write("window.MONSTERS = ")
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

print("条目:", len(items), "| 主羁绊组:", len(groups))
for g in groups:
    print(f"  {g['name']}: {g['count']}")
print("有图标:", sum(1 for i in items if i["icon"]), "/", len(items))
