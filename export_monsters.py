# -*- coding: utf-8 -*-
"""导出《卫戍协议·规程》全部怪物总表（CSV + Excel）
   列结构：主羁绊（阵营）+ 副羁绊（战术特性）
"""

import csv
import json
import os
from collections import Counter

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from rules import playable, power, factions_of, minors_of, subs_of

SRC = r"E:\明日方舟卫戍协议\SP\Stronghold-Protocol\data\versions\act3autochess-v3_1\enemies.json"
OUT = r"E:\明日方舟卫戍协议\4v4\怪物总表"
POOL_PATH = r"E:\明日方舟卫戍协议\4v4\data\units.json"
os.makedirs(OUT, exist_ok=True)

enemies = json.load(open(SRC, encoding="utf-8"))
RANK_CN = {"NORMAL": "普通", "ELITE": "精英", "BOSS": "首领"}
WAY_CN = {"MELEE": "近战", "RANGED": "远程", "ALL": "全能", "NONE": "无攻击"}


def recruit_state(x):
    if x.get("tokenOnly"):
        return "不可招募", "令牌/召唤物"
    if x.get("notCountInTotal"):
        return "不可招募", "不计入总数"
    if x.get("rank") == "BOSS":
        return "首领位", "仅开局选择"
    if not x.get("name"):
        return "不可招募", "无名称"
    if playable(x):
        return "候选", ""
    st = x.get("stats") or {}
    if (st.get("moveSpeed") or 0) <= 0.05:
        return "不可招募", "不可移动"
    if (st.get("atk") or 0) < 100:
        return "不可招募", "无输出"
    hp = st.get("maxHp") or 0
    if hp > 45000:
        return "不可招募", "血量超出区间"
    if hp < (400 if "源石虫" in (x.get("name") or "") else 1200):
        return "不可招募", "血量超出区间"
    if (st.get("def") or 0) > 2500:
        return "不可招募", "防御超出区间"
    if any(k in (x.get("name") or "") for k in ("帝国的甲胄", "斩胄", "破胄", "碎铳")):
        return "不可招募", "地图首领/装置"
    return "不可招募", "其他"


rows = []
for x in enemies.values():
    st = x.get("stats") or {}
    state, reason = recruit_state(x)
    facs = factions_of(x)
    subs = subs_of(x)
    rows.append({
        "名称": x.get("name") or "",
        "编号": x.get("key") or "",
        "分级": RANK_CN.get(x.get("rank"), x.get("rank")),
        "招募": state,
        "费用档": "",
        "排除原因": reason,
        "血量": st.get("maxHp"),
        "攻击": st.get("atk"),
        "防御": st.get("def"),
        "法抗": st.get("res"),
        "攻击间隔": st.get("bat"),
        "射程": st.get("rangeRadius"),
        "阻挡": st.get("blockCnt"),
        "移速": st.get("moveSpeed"),
        "攻击方式": WAY_CN.get(x.get("applyWay"), x.get("applyWay")),
        "飞行": "是" if x.get("isFlyEnemy") else "",
        "主羁绊": "、".join(facs),
        "小羁绊": "、".join(minors_of(x)),
        "副羁绊": "、".join(subs),
        "升星链": "", "原生形态": "",
        "技能数": len(x.get("skills") or []),
        "召唤数": len(x.get("summons") or []),
        "强度分": round(power(x), 1),
        "简介": (x.get("desc") or "").replace("\n", " "),
        "_rank": x.get("rank"),
        "_power": power(x),
    })

# 从招募池回填入选状态与费用
pool = {u["id"]: u for u in json.load(open(POOL_PATH, encoding="utf-8"))["units"]}
for r in rows:
    u = pool.get(r["编号"])
    if u:
        r["招募"] = "可招募"
        r["费用档"] = u["cost"]
        r["排除原因"] = ""
        r["主羁绊"] = "、".join(u.get("factions") or [])
        r["小羁绊"] = "、".join(u.get("minors") or [])
        r["副羁绊"] = "、".join(u.get("subs") or [])
        st = u.get("stars") or []
        r["升星链"] = " → ".join(
            (f"{s['star']}★{s['name']}" if not s.get("synthetic") else f"{s['star']}★(强化)")
            for s in st)
        r["原生形态"] = "是" if any(not s.get("synthetic") for s in st[1:]) else "合成"
    else:
        for pid, pu in pool.items():
            for s in (pu.get("stars") or []):
                if s.get("id") == r["编号"] and s["star"] > 1:
                    r["升星链"] = f"{pu['name']} 的 {s['star']}★ 形态"
                    r["招募"] = "升星形态"
                    break

for r in rows:
    if r["招募"] == "候选" and not r["费用档"]:
        r["排除原因"] = "数值合格，未进首发池"

order = {"BOSS": 0, "ELITE": 1, "NORMAL": 2}
rows.sort(key=lambda r: (order.get(r["_rank"], 9), -(r["_power"])))

COLS = ["名称", "编号", "分级", "招募", "费用档", "排除原因", "血量", "攻击", "防御", "法抗",
        "攻击间隔", "射程", "阻挡", "移速", "攻击方式", "飞行", "主羁绊", "小羁绊", "副羁绊",
        "升星链", "原生形态", "技能数", "召唤数", "强度分", "简介"]

csv_path = os.path.join(OUT, "怪物总表.csv")
with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)

wb = Workbook()
ws = wb.active
ws.title = "怪物总表"
ws.append(COLS)
for r in rows:
    ws.append([r[c] for c in COLS])

head_fill = PatternFill("solid", fgColor="1F1216")
head_font = Font(color="E8E2DA", bold=True, size=10)
for c in range(1, len(COLS) + 1):
    cell = ws.cell(row=1, column=c)
    cell.fill = head_fill
    cell.font = head_font
    cell.alignment = Alignment(horizontal="center", vertical="center")

rank_fill = {
    "首领": PatternFill("solid", fgColor="F4C7C3"),
    "精英": PatternFill("solid", fgColor="FCE5CD"),
    "普通": PatternFill("solid", fgColor="EFEFEF"),
}
for i, r in enumerate(rows, start=2):
    fill = rank_fill.get(r["分级"])
    if fill:
        for c in range(1, len(COLS) + 1):
            ws.cell(row=i, column=c).fill = fill
    if r["招募"] == "可招募":
        ws.cell(row=i, column=4).font = Font(color="1E7B45", bold=True)

widths = {"名称": 22, "编号": 28, "分级": 8, "招募": 10, "费用档": 8, "排除原因": 16,
          "主羁绊": 18, "小羁绊": 16, "副羁绊": 18, "升星链": 42, "原生形态": 9, "简介": 70}
for i, c in enumerate(COLS, start=1):
    ws.column_dimensions[get_column_letter(i)].width = widths.get(c, 9)
ws.freeze_panes = "A2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(COLS))}{len(rows) + 1}"

ws2 = wb.create_sheet("统计")
stat = [
    ("怪物总数", len(rows)),
    ("普通", sum(1 for r in rows if r["分级"] == "普通")),
    ("精英", sum(1 for r in rows if r["分级"] == "精英")),
    ("首领", sum(1 for r in rows if r["分级"] == "首领")),
    ("可招募", sum(1 for r in rows if r["招募"] == "可招募")),
    ("2 费", sum(1 for r in rows if r["费用档"] == 2)),
    ("3 费", sum(1 for r in rows if r["费用档"] == 3)),
    ("4 费", sum(1 for r in rows if r["费用档"] == 4)),
    ("飞行单位", sum(1 for r in rows if r["飞行"] == "是")),
    ("带技能", sum(1 for r in rows if r["技能数"] > 0)),
    ("会召唤", sum(1 for r in rows if r["召唤数"] > 0)),
]
ws2.append(["项目", "数量"])
for k, v in stat:
    ws2.append([k, v])

ws2.append([])
ws2.append(["主羁绊分布（全量）", ""])
for k, v in Counter(t for r in rows for t in r["主羁绊"].split("、") if t).most_common():
    ws2.append([k, v])

ws2.append([])
ws2.append(["主羁绊分布（首发池）", ""])
for k, v in Counter(t for r in rows if r["招募"] == "可招募"
                    for t in r["主羁绊"].split("、") if t).most_common():
    ws2.append([k, v])

ws2.append([])
ws2.append(["小羁绊分布（全量）", ""])
for k, v in Counter(t for r in rows for t in r["小羁绊"].split("、") if t).most_common():
    ws2.append([k, v])

ws2.append([])
ws2.append(["副羁绊分布（首发池）", ""])
for k, v in Counter(t for r in rows if r["招募"] == "可招募"
                    for t in r["副羁绊"].split("、") if t).most_common():
    ws2.append([k, v])

ws2.column_dimensions["A"].width = 26
ws2.column_dimensions["B"].width = 10

xlsx_path = os.path.join(OUT, "怪物总表.xlsx")
wb.save(xlsx_path)

print(f"总表 {len(rows)} 行")
print("入选:", sum(1 for r in rows if r["招募"] == "可招募"),
      "| 2费", sum(1 for r in rows if r["费用档"] == 2),
      "3费", sum(1 for r in rows if r["费用档"] == 3),
      "4费", sum(1 for r in rows if r["费用档"] == 4))
print("主羁绊分布(池内):",
      dict(Counter(t for r in rows if r["招募"] == "可招募"
                   for t in r["主羁绊"].split("、") if t)))
