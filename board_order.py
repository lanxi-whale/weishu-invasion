# -*- coding: utf-8 -*-
"""棋盘出怪顺序：按到最近红门（tile_start）的曼哈顿距离分批

数据来源 data/board.json —— 直接取自 data/stages.json 里 act1autochess_m01 的
rows 9~13 × cols 2~10：红门 = S、蓝门 = E、可部署格 = deployTiles.normal.melee。

用法：
    python board_order.py          # 打印批次号与每批格子
"""

import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
BOARD = json.load(open(os.path.join(BASE, "data", "board.json"), encoding="utf-8"))

ROWS, COLS = BOARD["rows"], BOARD["cols"]
GATES = BOARD["gates"]
DEPLOY = [tuple(x) for x in BOARD["deploy"]]
GLYPHS = BOARD["glyphs"]


def dist_to_gate(r, c):
    """到最近红门的曼哈顿距离（同一张地图有两个红门）"""
    return min(abs(r - g["r"]) + abs(c - g["c"]) for g in GATES)


def batch_map():
    """返回 {(r,c): (batch_no, distance)}，同距离 = 同一批"""
    dists = sorted({dist_to_gate(r, c) for r, c in DEPLOY})
    out = {}
    for r, c in DEPLOY:
        d = dist_to_gate(r, c)
        out[(r, c)] = (dists.index(d) + 1, d)
    return out


def main():
    bm = batch_map()
    print(f"{BOARD['name']}  {COLS} 列 × {ROWS} 行   红门 {len(GATES)} 个  "
          f"蓝门 {len(BOARD['ends'])} 个   可部署 {len(DEPLOY)} 格")
    print("批次表（. = 不可部署 / 空地，A、B = 红门，E = 蓝门）:\n")
    gate_at = {(g['r'], g['c']): g['id'] for g in GATES}
    end_at = {(e['r'], e['c']) for e in BOARD['ends']}
    for r in range(ROWS):
        line = []
        for c in range(COLS):
            if (r, c) in bm:
                line.append(f"{bm[(r, c)][0]:>2}")
            elif (r, c) in gate_at:
                line.append(f" {gate_at[(r, c)]}")
            elif (r, c) in end_at:
                line.append(" E")
            else:
                line.append(" .")
        print("   " + " ".join(line))
    print("\n按批次：")
    by = {}
    for (r, c), (b, d) in bm.items():
        by.setdefault(b, []).append((r, c))
    for b in sorted(by):
        print(f"  第 {b} 批 (距离 {bm[by[b][0]][1]}): "
              + "、".join(f"({r},{c})" for r, c in sorted(by[b])))


if __name__ == "__main__":
    main()
