# -*- coding: utf-8 -*-
"""怪物阵营的判定规则与羁绊定义（生成器与图鉴共用）"""

AC_CN = {
    "SPECIAL": "特异", "CRITIC": "致命", "REBORN": "复苏", "INVISIBLE": "隐匿",
    "ELEMENT": "元素", "REFLECTION": "折射", "FLY": "飞行", "DOT": "持续", "TIMES": "频次",
}
BOSSISH = ("帝国的甲胄", "斩胄", "破胄", "碎铳")
MAX_MAIN_PER_UNIT = 3
BOND_INCLUSIONS = {"drone": {"enemy_10084_hlegle"}}
BOND_EXCLUSIONS = {
    "INVISIBLE": {"enemy_1043_zomsbr", "enemy_10042_prtrop", "enemy_10042_prtrop_2",
                  "enemy_10043_sailor", "enemy_1381_winman", "enemy_1381_winman_2"},
    "infection": {"enemy_1325_cbgpro", "enemy_1325_cbgpro_2", "enemy_1000_gopro_2"},
}

# These variants are independent recruits despite their native suffixes.
INDEPENDENT_ENEMY_VARIANTS = {"enemy_1104_lfkght_3"}


def native_star_base(key, enemies):
    base, _, suffix = key.rpartition("_")
    if suffix not in ("2", "3") or base not in enemies or key in INDEPENDENT_ENEMY_VARIANTS:
        return None
    base_name = nm(enemies[base])
    variant_name = nm(enemies[key])
    if ("残党" in base_name and "巫王" in variant_name) or ("巫王" in base_name and "残党" in variant_name):
        return None
    return base, int(suffix)


# These strategy variants have lower HP (and, for Gopnik, lower ATK).
# Swap the invasion card stats while retaining each form's original enemy ID.
REVERSED_STAR_STATS = {
    key: other
    for base in ("enemy_2001_duckmi", "enemy_2002_bearmi", "enemy_2034_sythef", "enemy_2085_skzjxd")
    for key, other in ((base, base + "_2"), (base + "_2", base))
}


def invasion_star_stats(enemy, enemies):
    stats = enemy.get("stats") or {}
    other = REVERSED_STAR_STATS.get(enemy.get("key"))
    if other is None:
        return stats
    swapped = enemies[other]["stats"]
    return {**stats, "maxHp": swapped["maxHp"], "atk": swapped["atk"]}


def power(x):
    s = x.get("stats") or {}
    return ((s.get("maxHp") or 0) / 1000 * 1.0 + (s.get("atk") or 0) / 200 * 1.2
            + (s.get("def") or 0) / 150 * 0.8 + (s.get("res") or 0) / 20 * 0.4)


def playable(x):
    if x.get("tokenOnly") or x.get("notCountInTotal"):
        return False
    if x.get("rank") not in ("NORMAL", "ELITE", "BOSS"):
        return False
    if not x.get("name"):
        return False
    if any(k in x["name"] for k in BOSSISH):
        return False
    if x.get("rank") == "BOSS":
        return True
    st = x.get("stats") or {}
    if (st.get("moveSpeed") or 0) <= 0.05:
        return False
    if (st.get("atk") or 0) < 100:
        return False
    hp_floor = 400 if "源石虫" in x["name"] else 1200
    if not (hp_floor <= (st.get("maxHp") or 0) <= 45000):
        return False
    if (st.get("def") or 0) > 2500:
        return False
    return True


def nm(x):
    return x.get("name") or ""


def tags(x):
    return x.get("tags") or []


def acs(x):
    return x.get("acTypes") or []


REUNION_KW = ("宿主", "雪怪", "粉碎", "潜伏者", "隐形", "寻仇", "重装防御",
              "重装侦察", "重装五十夫长", "速射轻弩手", "速射劲弩手",
              "游击队盾卫", "集团军中坚盾卫")
DRONE_KW = ("妖怪", "威龙", "御4", "暴鸰", "法术大师", "寒霜", "帝国炮火", "无人机")


def is_reunion(x):
    return any(k in nm(x) for k in REUNION_KW) and not nm(x).startswith("深池")


def is_drone(x):
    return x.get("key") in BOND_INCLUSIONS["drone"] or any(k in nm(x) for k in DRONE_KW)


SLUG_SPIDERS = {"enemy_1132_sarchn", "enemy_1133_harchn"}


def is_slug(x):
    return "源石虫" in nm(x) or x.get("key") in SLUG_SPIDERS


def is_abyss(x):
    return nm(x).startswith("深池")


DECAY_KW = ("枯朽", "子裔", "奇美拉", "灵幛", "魂灵")
DECAY_ENEMIES = {
    "enemy_1270_nhstlk", "enemy_1270_nhstlk_2",
    "enemy_1425_lrcmra", "enemy_1425_lrcmra_2",
}


def is_decay(x):
    name = nm(x)
    return x.get("key") in DECAY_ENEMIES or any(keyword in name for keyword in DECAY_KW)


def is_court(x):
    return "sarkaz" in tags(x) and not is_decay(x)


def is_witchking(x):
    n = nm(x)
    return ("巫王乐团" in n) or ("残党乐团" in n)


def is_remnant(x):
    return "残党乐团" in nm(x)


# ---------------------------------------------------------------- 手动归属（来自图鉴里的指派，优先级最高）
# 组名 -> 成员名称（名称相同的基础/进阶形态一并计入）
MANUAL_NAMES = {
    "炎": ("烹泉", "沏虹", "堂皇", "鼎沸", "清明", "新硎", "身观", "雅气", "明鉴",
           "俗心", "磨砻", "沉沙", "鼠王", "后兽", "矩兽", "山海众头目"),
    "雪怪": ("雪怪小队", "雪怪小队破冰者"),
    "特殊": ("圆仔", "高普尼克", "鸭爵", "流泪小子"),
    "狂欢": ("节日气球", "业余竞演者", "节日爵士乐手"),
    "萨科塔": ("圣堂剑士", "“萨科塔之翼”", "“萨科塔昂首”", "“萨科塔之眼”"),
    "假想敌": ("假想敌：茧", "假想敌：鳍", "假想敌：镜波", "假想敌：影役", "假想敌：丛生",
              "假想敌：镜眼", "假想敌：镜膜", "假想敌：再生", "假想敌：骨刺", "假想敌：蚀裂",
              "假想敌：黑云", "假想敌：淤困", "假想敌：弦"),
    "剧场": ("心虚设计师", "反派阵营角色", "主角阵营角色", "临时收音师", "骇笑看客"),
    "囚犯": ("重犯", "强壮囚犯", "拳师囚犯", "杰斯顿·威廉姆斯", "普通囚犯"),
    "弧光": ("弧光镜卫", "弧光锋卫"),
    "访问团": ("访问团持盾者", "“喷射罐”", "访问团强攻冠军", "访问团新兵"),
    "莱茵生命": ("莱茵生命防卫科高级成员", "Dor-β号复制体", "测试用动力装甲", "Dor-1号失败品"),
    "骑士团": ("沸血骑士团精锐", "锋盔骑士团学徒", "“左手”泰特斯·白杨"),
    "水": ("码头水手", "咸鳞汁推荐者", "寻险水手", "架桥船工", "控潮术师", "潜水员", "术师快艇"),
    "寻路者": ("寻路者狙击手", "寻路者阵地破坏者", "战线推进者", "寻路者信使"),
}


def _clean(x):
    return nm(x).strip('"“”').strip()


MANUAL_CLEAN = {k: {n.strip('"“”').strip() for n in v} for k, v in MANUAL_NAMES.items()}


def _match(name, fn, x):
    names = MANUAL_CLEAN.get(name)
    if names is not None:
        return _clean(x) in names
    return fn(x)


# 炎国：按你截图里指派的 12 个名称（岁/炎国系列）
YAN_NAMES = ("后兽", "矩兽", "鼠王", "鼎沸", "清明", "炎佑", "沉沙",
             "山海众头目", "身观", "烹泉", "俗心", "磨砻")


def is_yan(x):
    n = nm(x).strip('"“”')
    if any(k == n or k in n for k in YAN_NAMES):
        return True
    return "炎国" in (x.get("desc") or "")


def is_fly(x):
    return bool(x.get("isFlyEnemy")) or "FLY" in acs(x)


def is_hidden(x):
    return x.get("key") not in BOND_EXCLUSIONS["INVISIBLE"] and ("INVISIBLE" in acs(x) or "隐" in nm(x))


def is_infection(x):
    return x.get("key") not in BOND_EXCLUSIONS["infection"] and "infection" in tags(x)


def is_phantasm(x):
    return "假想敌" in nm(x)


MAIN_BONDS = [
    # key, 显示名, 判定, 保底名额, 备注
    ("yan",       "炎",          is_yan,       6, "岁/炎国系列 12 个（含 3 个首领）"),
    ("seaborn",   "海嗣",        lambda x: "seamonster" in tags(x), 6, ""),
    ("slug",      "源石虫",      is_slug,       5, ""),
    ("court",     "萨卡兹",      is_court,      8, "王庭军 / 雇佣兵 / 骑士等非枯朽系"),
    ("decay",     "萨卡兹·枯朽", is_decay,      6, "枯朽 / 子裔 / 奇美拉 / 灵幛 / 魂灵 / 逐腐兽"),
    ("reunion",   "整合运动",    is_reunion,    8, ""),
    ("drone",     "无人机",      is_drone,      5, ""),
    ("witchking", "巫王乐团",    is_witchking,  6, "含巫王乐团 / 残党乐团两支"),
    ("phantasm",  "假想敌",      is_phantasm,   6, "仅普通/精英级，BOSS 级仍是首领"),
    ("infection", "感染",        is_infection, 8, ""),
    ("abyss",     "深池",        is_abyss,      6, "正式主羁绊：名称以「深池」开头"),
]

SUB_BONDS = [
    ("SPECIAL",    "特异", lambda x: "SPECIAL" in acs(x)),
    ("FLY",        "飞行", is_fly),
    ("TIMES",      "频次", lambda x: "TIMES" in acs(x)),
    ("ELEMENT",    "元素", lambda x: "ELEMENT" in acs(x)),
    ("DOT",        "持续", lambda x: "DOT" in acs(x)),
    ("INVISIBLE",  "隐匿", is_hidden),
    ("REFLECTION", "折射", lambda x: "REFLECTION" in acs(x)),
    ("CRITIC",     "致命", lambda x: "CRITIC" in acs(x)),
    ("REBORN",     "复苏", lambda x: "REBORN" in acs(x)),
]

MINOR_BONDS = [
    # key, 显示名, 判定, 备注
    ("snow",       "雪怪",     lambda x: "雪怪" in nm(x), ""),
    ("special",    "特殊",     lambda x: False, "数据里没有对应成员，待指派"),
    ("carnival",   "狂欢",     lambda x: "狂欢" in (x.get("desc") or "") or "狂欢" in nm(x), ""),
    ("sankta",     "萨科塔",   lambda x: "萨科塔" in nm(x), ""),
    ("theater",    "剧场",     lambda x: False, "数据里没有对应成员，待指派"),
    ("prisoner",   "囚犯",     lambda x: "囚犯" in nm(x) or nm(x) == "重犯", ""),
    ("arc",        "弧光",     lambda x: "弧光" in nm(x), ""),
    ("visitor",    "访问团",   lambda x: "访问团" in nm(x), ""),
    ("rhine",      "莱茵生命", lambda x: "莱茵" in nm(x), ""),
    ("knight",     "骑士团",   lambda x: "骑士团" in nm(x), ""),
    ("water",      "水",       lambda x: any(k in nm(x) for k in ("水手", "潜水", "水遁"))
                                            and "汽水瓶" not in nm(x), ""),
    ("pathfinder", "寻路者",   lambda x: "寻路者" in nm(x), ""),
]

# 每局随机启用的羁绊数量
MATCH_RULES = {"mainPick": 6, "minorPick": 6, "mainCap": 10}

NAME_OF_MAIN = {k: n for k, n, *_ in MAIN_BONDS}
NAME_OF_MINOR = {k: n for k, n, _f, _r in MINOR_BONDS}
NAME_OF_SUB = {k: n for k, n, _f in SUB_BONDS}
PRIORITY = [k for k, *_ in MAIN_BONDS]


# 白名单：这几个召唤物保留，照常参与羁绊与卡池
KEEP_TOKEN_NAMES = ("雪怪小队破冰者",)


def _excluded(x):
    """首领与召唤物都不参与羁绊（白名单除外）"""
    if x.get("rank") == "BOSS":
        return True
    if x.get("tokenOnly") and nm(x) not in KEEP_TOKEN_NAMES:
        return True
    return False


def main_keys_of(x):
    if _excluded(x):
        return []
    hit = [k for k, n, fn, _q, _r in MAIN_BONDS if _match(n, fn, x)]
    hit.sort(key=lambda k: len(PRIORITY) if k == "slug" and x.get("key") in SLUG_SPIDERS else PRIORITY.index(k))
    return hit[:MAX_MAIN_PER_UNIT]


def sub_keys_of(x):
    return [k for k, _n, fn in SUB_BONDS if fn(x)]


def minor_keys_of(x):
    if _excluded(x):
        return []
    return [k for k, n, fn, _r in MINOR_BONDS if _match(n, fn, x)]


def minors_of(x):
    return [NAME_OF_MINOR[k] for k in minor_keys_of(x)]


def factions_of(x):
    return [NAME_OF_MAIN[k] for k in main_keys_of(x)]


def subs_of(x):
    return [NAME_OF_SUB[k] for k in sub_keys_of(x)]
