# -*- coding: utf-8 -*-
"""把 4v4 的怪物数据注入原版副本 （4v4/game/data/*.json）

- units.json   → data/chess.json   （1★ = 基础棋子，2★ = golden 棋子）
- bonds.json   → data/bonds.json   （主/小/副 三档羁绊）
- 立绘         → data/assets.json  （chars[<enemyId>] = 怪物图标的 URL）

用法： python gen_game_monsters.py [--dry | --refresh-bond main_slug | --refresh-tiers | --refresh-star-stats]
"""
import json, os, sys, shutil
from rules import REVERSED_STAR_STATS, invasion_star_stats

ROOT = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.join(ROOT, "game")
DATA = os.path.join(GAME, "data")

MON = "mon_"          # 羁绊 id 前缀，避免和干员羁绊撞名
POW = "monpow_"       # nationId 前缀

# Maintainer removal: 炎佑 is a battlefield device, not a selectable monster.
EXCLUDED_UNITS = {"enemy_9012_acloon"}

def prune_excluded(chess):
    for uid in EXCLUDED_UNITS:
        for suffix in ("", "_b"):
            chess.pop("chess_mon_" + uid + suffix, None)

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def dump(p, obj):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)

def ensure_backup(p):
    b = p + ".orig"
    if not os.path.exists(b):
        shutil.copyfile(p, b)

targets = [DATA]
vd = os.path.join(DATA, "versions")
if os.path.isdir(vd):
    targets += [os.path.join(vd, d) for d in sorted(os.listdir(vd)) if os.path.isdir(os.path.join(vd, d))]

# Update just the removed records without rebuilding unrelated generated data.
if "--prune-excluded" in sys.argv:
    for target in targets:
        cp = os.path.join(target, "chess.json")
        if os.path.isfile(cp):
            chess = load(cp)
            prune_excluded(chess)
            dump(cp, chess)
            print(os.path.relpath(cp, ROOT))
    sys.exit(0)

units_path = os.path.join(ROOT, "data", "units.json")
units_doc = load(units_path)
units = units_doc["units"]
if "--target" in sys.argv:
    targets = [os.path.abspath(sys.argv[sys.argv.index("--target") + 1])]

if "--refresh-star-stats" in sys.argv:
    corrected = [u for u in units if u["id"] in REVERSED_STAR_STATS]
    source = load(os.path.join(DATA, "enemies.json"))
    for unit in corrected:
        for star in unit["stars"]:
            stats = invasion_star_stats(source[star["id"]], source)
            star.update(hp=stats["maxHp"], atk=stats["atk"])
        unit.update(hp=unit["stars"][0]["hp"], atk=unit["stars"][0]["atk"])
    dump(units_path, units_doc)

    for target in targets:
        cp = os.path.join(target, "chess.json")
        if not os.path.isfile(cp):
            continue
        chess = load(cp)
        enemies = load(os.path.join(target, "enemies.json"))
        for unit in corrected:
            for star in unit["stars"]:
                suffix = "_b" if star["star"] == 2 else ""
                stats = invasion_star_stats(enemies[star["id"]], enemies)
                chess["chess_mon_" + unit["id"] + suffix]["stats"].update(maxHp=stats["maxHp"], atk=stats["atk"])
        dump(cp, chess)
        print(os.path.relpath(cp, ROOT))
    sys.exit(0)

TIER_OF = {2: 1, 3: 3, 4: 5}
tier_config = load(os.path.join(ROOT, "data", "monster_tiers.json"))
tier_overrides = {uid: int(tier) for tier, members in tier_config.items() for uid in members}
tiers = {
    u["id"]: tier_overrides.get(u["id"], TIER_OF.get(int(u["cost"]), int(u["cost"])))
    for u in units if u["id"] not in EXCLUDED_UNITS
}

def recruit_price(tier):
    return (tier + 1) // 2 + 1


# Preserve each version's stats, bonds and art when refreshing tiers and prices.
if "--refresh-tiers" in sys.argv:
    for target in targets:
        cp = os.path.join(target, "chess.json")
        if not os.path.isfile(cp):
            continue
        chess = load(cp)
        changed = 0
        for uid, tier in tiers.items():
            price = recruit_price(tier)
            for suffix in ("", "_b"):
                record = chess.get("chess_mon_" + uid + suffix)
                if record is not None and (record["tier"] != tier or record["price"] != price):
                    record.update(tier=tier, price=price)
                    changed += 1
        if changed:
            dump(cp, chess)
        print(os.path.relpath(cp, ROOT), changed)
    sys.exit(0)

bonds = load(os.path.join(ROOT, "data", "bonds.json"))
count_rules = load(os.path.join(ROOT, "data", "monster_bond_effects.json"))["bonds"]
official_enemies = load(sys.argv[sys.argv.index("--official-enemies") + 1]) if "--official-enemies" in sys.argv else None

# ---- 羁绊 ----------------------------------------------------------------
bond_add, bond_meta = {}, {}
seq = 900
for kind, core in (("main", True), ("minor", False), ("sub", False)):
    for b in bonds[kind]:
        bid = MON + b["id"]
        name = b["name"]
        thr = list(b.get("thresholds") or [2])
        if not thr:
            thr = [2]
        bonus_tiers = count_rules.get(bid)
        member_count = b.get("memberCount") or len(b.get("members") or [])
        description = f'【{name}】怪物羁绊 · 池内 {member_count} {"种" if bonus_tiers else "只"}'
        if bonus_tiers:
            if thr != [tier["distinctSpecies"] for tier in bonus_tiers]:
                raise ValueError("inconsistent bond thresholds: " + bid)
            description += "\n" + "\n".join(
                f'在场 {tier["distinctSpecies"]} 种不同的【{name}】时，每个【{name}】单位增加 {tier["extraPerUnit"]} 只怪物。'
                for tier in bonus_tiers
            ) + "\n只生效最高档，不叠加。"
        bond_add[bid] = {
            "bondId": bid,
            "name": name,
            "identifier": seq,
            "isCore": core,
            "bondType": "SEASON",
            "bondOrder": seq,
            "powerIdList": [POW + b["key"].lower()],
            "iconId": "icon_" + b["id"],
            "activeCount": thr[0],
            "thresholds": thr,
            "maxCount": None,
            "thresholdTemplate": "count_threshold_upward",
            "countMode": "BOARD",
            "countsHand": False,
            "countsGoldenOnly": False,
            "activeType": "BATTLE",
            "isActiveInDeck": False,
            "noStack": False,
            "weight": 0 if kind == "sub" else 10,
            "maxInactiveBondCount": -1,
            "layerMilestones": [],
            "desc": description,
        }
        bond_meta[b["id"]] = bid
        seq += 1

# ---- 棋子 ----------------------------------------------------------------
def range_grid(r):
    if not r:
        return [[0, 0]]
    out = []
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if abs(dy) + abs(dx) <= r:
                out.append([dx, dy])
    return out

icon_dir = os.path.join(GAME, "public", "assets", "enemy", "icon")
def icon_path(eid):
    p = os.path.join(icon_dir, eid + ".png")
    return "/assets/enemy/icon/%s.png" % eid if os.path.exists(p) else None

chess_add, char_add = {}, {}
sid = 9000
for u in units:
    uid = u["id"]
    if uid in EXCLUDED_UNITS:
        continue
    s1 = u["stars"][0]
    s2 = u["stars"][1] if len(u["stars"]) > 1 else None
    bid = "chess_mon_" + uid
    gid = "chess_mon_" + uid + "_b"
    pos = "MELEE" if (u.get("applyWay") or "MELEE") == "MELEE" else "RANGED"
    rg = range_grid(int(u.get("range") or 0))
    # 羁绊
    bs = []
    for k in (u.get("bondKeys") or []):
        key = "main_" + k
        if key in bond_meta:
            bs.append(bond_meta[key])
    for k in (u.get("minorKeys") or []):
        key = "minor_" + k
        if key in bond_meta:
            bs.append(bond_meta[key])
    for k in (u.get("subKeys") or []):
        key = "sub_" + str(k).lower()
        if key in bond_meta:
            bs.append(bond_meta[key])
    nation = POW + ((u.get("bondKeys") or ["none"])[0]).lower()
    # 立绘
    for star, eid in ((1, s1["id"]), (2, (s2 or s1)["id"])):
        url = icon_path(eid)
        if url is None and star == 2:
            url = icon_path(uid)
        if url:
            pp = "/assets/enemy/portrait/%s.png" % eid
            portrait = pp if os.path.exists(os.path.join(GAME, "public", pp.lstrip("/"))) else url
            char_add[eid] = {"avatar": url, "portrait": portrait}

    def stats(st, eid):
        result = {
            "maxHp": int(st["hp"]), "atk": int(st["atk"]), "def": int(st["def"]), "res": int(st["res"]),
            "cost": 0, "blockCnt": int(u.get("block") or 1), "bat": float(st.get("bat") or 1.5),
            "aspd": 100, "respawnTime": 70, "spRecovery": 1, "hpRecoveryPerSec": 0,
            "moveSpeed": float(u.get("moveSpeed") or 1), "tauntLevel": 0, "massLevel": 0,
            "deployLimit": 1, "deckStack": 0,
        }
        if official_enemies is not None:
            # Native variants use their own official record. Synthetic 2-star units retain
            # the existing 4v4 upgrade ratio on top of the current official base stats.
            native = official_enemies.get(eid)
            base = official_enemies.get(uid)
            source = (native or base)
            if source is None:
                raise ValueError("official enemy missing: " + eid)
            source = invasion_star_stats(source, official_enemies)
            for key in ("maxHp", "atk", "def", "res", "aspd", "bat", "moveSpeed", "hpRecoveryPerSec", "massLevel", "tauntLevel", "blockCnt"):
                if key not in source:
                    continue
                ratio = 1
                old_key = {"maxHp": "hp", "atk": "atk", "def": "def", "res": "res"}.get(key)
                if native is None and old_key and s1.get(old_key):
                    ratio = st[old_key] / s1[old_key]
                result[key] = source[key] * ratio
        return result

    spine_dir = os.path.join(GAME, "public", "assets", "spine", "enemy")
    spine_1 = uid if os.path.isdir(os.path.join(spine_dir, uid)) else None
    spine_2 = s1["id"] if False else ((s2 or s1)["id"] if os.path.isdir(os.path.join(spine_dir, (s2 or s1)["id"])) else spine_1)

    def entry(cid, st, is_golden, sib, name, spine_id=spine_1):
        return {
            "chessId": cid, "baseId": bid, "goldenId": gid,
            "isGolden": is_golden, "tier": tiers[uid], "identifier": 0,
            "isHidden": False, "isDiy": False, "visible": True, "chessType": "PRESET",
            "backup": {"charId": None, "tmplId": None, "skillIndex": 0, "uniEquipId": None, "potRank": 0},
            "shopSortId": 0, "charId": None, "name": name, "appellation": None,
            "rarity": 4, "profession": "WARRIOR" if pos == "MELEE" else "SNIPER",
            "subProfessionId": None, "subProfessionName": (u.get("minors") or ["近战"])[0],
            "position": pos, "nationId": nation, "bonds": bs, "garrisonIds": [],
            "price": recruit_price(tiers[uid]), "sellPrice": 1, "upgradeNum": 0 if is_golden else 3,
            "upgradeChessId": None if is_golden else gid,
            "status": {"phase": 2 if is_golden else 1, "level": 1, "skillLevel": 1, "equipLevel": 0},
            "stats": stats(st, sib), "immunities": {"stun": False, "silence": False, "sleep": False,
                                                    "frozen": False, "levitate": False},
            "rangeId": "1-1", "rangeGrid": rg, "dmgType": u.get("dmgType") or "phys",
            "attackKind": "melee" if pos == "MELEE" else "ranged", "projectile": None,
            "canHitFly": bool(u.get("fly")), "targetPriority": None,
            "trait": {"desc": u.get("desc") or "", "descRaw": u.get("desc") or "", "bb": {}, "bbStr": {}, "rangeGrid": None},
            "skill": {"skillId": None, "iconId": None, "name": "", "level": 1, "desc": "", "descRaw": "",
                      "skillType": "AUTO", "durationType": "NONE", "duration": 0, "spType": "INCREASE_WITH_TIME",
                      "spCost": 0, "initSp": 0, "maxChargeTime": 0, "increment": 1, "bb": {}, "bbStr": {},
                      "rangeId": None, "rangeGrid": None, "prefabId": None, "trigger": None, "index": 0,
                      "overrideTokenKey": None},
            "assets": {"avatar": sib, "portrait": sib, "spine": spine_id},
        }

    chess_add[bid] = entry(bid, s1, False, s1["id"], u["name"], spine_1)
    if s2:
        chess_add[gid] = entry(gid, s2, True, s2["id"], s2["name"], spine_2)

# ---- 编号 ---------------------------------------------------------------
chess = load(os.path.join(DATA, "chess.json"))
official_chess = [v for k, v in chess.items() if not k.startswith("chess_mon_")]
start_id = max([c.get("identifier") or 0 for c in official_chess] + [0]) + 1
start_sort = max([c.get("shopSortId") or 0 for c in official_chess] + [0]) + 1
for i, (cid, rec) in enumerate(sorted(chess_add.items())):
    cat = 1 if not rec["isGolden"] else 2
    rec["identifier"] = start_id + i
    rec["shopSortId"] = start_sort + i
    rec["_cat"] = cat

# ---- 写入（vanilla + 每个版本目录） -------------------------------------
if "--dry" in sys.argv:
    print("bonds", len(bond_add), "chess", len(chess_add), "chars", len(char_add))
    sys.exit(0)

if "--refresh-bond" in sys.argv:
    refresh_id = MON + sys.argv[sys.argv.index("--refresh-bond") + 1]
    generated = bond_add[refresh_id]
    main_prefix = MON + "main_"
    refresh_nation = POW + refresh_id.removeprefix(main_prefix) if refresh_id.startswith(main_prefix) else None
    for target in targets:
        chess_path = os.path.join(target, "chess.json")
        bond_path = os.path.join(target, "bonds.json")
        chess_obj, bond_obj = load(chess_path), load(bond_path)
        bond_obj[refresh_id].update({field: generated[field] for field in ("desc", "thresholds", "activeCount")})
        for chess_id, record in chess_obj.items():
            generated_chess = chess_add.get(chess_id)
            if generated_chess is None:
                continue
            membership = record.get("bonds", [])
            basis = generated_chess["bonds"]
            if (refresh_id in basis) == (refresh_id in membership):
                continue
            if refresh_id in basis:
                successors = basis[basis.index(refresh_id) + 1:]
                index = next((index for index, bond_id in enumerate(membership) if bond_id in successors), len(membership))
                membership.insert(index, refresh_id)
            else:
                membership.remove(refresh_id)
            if refresh_nation and (refresh_id in membership or record.get("nationId") == refresh_nation):
                primary = next((bond_id.removeprefix(main_prefix) for bond_id in membership if bond_id.startswith(main_prefix)), "none")
                record["nationId"] = POW + primary
        dump(chess_path, chess_obj)
        dump(bond_path, bond_obj)
        print(os.path.relpath(target, ROOT))
    sys.exit(0)

report = []
for tdir in targets:
    cp = os.path.join(tdir, "chess.json")
    if not os.path.exists(cp):
        continue
    # 只有带 chess/bonds 的目录才注入
    chess_obj = load(cp)
    prune_excluded(chess_obj)
    for k, v in chess_add.items():
        rec = {kk: vv for kk, vv in v.items() if kk != "_cat"}
        chess_obj[k] = rec
    dump(cp, chess_obj)

    bp = os.path.join(tdir, "bonds.json")
    if os.path.exists(bp):
        b_obj = load(bp)
        for k, v in bond_add.items():
            b_obj[k] = v
        dump(bp, b_obj)

    cfgp = os.path.join(tdir, "config.json")
    if os.path.exists(cfgp):
        c = load(cfgp)
        c["monsterOnly"] = True
        dump(cfgp, c)
    report.append(os.path.relpath(tdir, GAME))

# 资源清单是全局的
assets_obj = load(os.path.join(DATA, "assets.json"))
chars = assets_obj.setdefault("chars", {})
for k, v in char_add.items():
    chars[k] = {**chars.get(k, {}), **v}
dump(os.path.join(DATA, "assets.json"), assets_obj)

print("注入完成：棋子 %d，羁绊 %d，立绘 %d" % (len(chess_add), len(bond_add), len(char_add)))
print("写入目录：", "、".join(report))
