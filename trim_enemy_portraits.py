#!/usr/bin/env python
# 4v4/trim_enemy_portraits.py — 把怪物（敌人）立绘上方的透明区裁掉
#
# 背景：敌人立绘是 180×360 的画布，但内容只画在下半部分（y=153 起，上面 42% 全透明）。
# 商店卡片 / 详情面板是按「整张图都是内容」来排版的，所以不裁的话卡面上半是空的、
# 图挤在底部一条 —— 看起来就是「图片歪了」。
#
# 这个脚本把 data/chess.json 里 chess_mon_* 用到的立绘（经 data/assets.json 的 chars[].portrait 解析）
# 按 alpha 边界裁掉上面的透明区，原地覆盖。原图备份在 4v4/_backup_enemy_portrait/。
# 重新下载 / 解包资源之后跑一次即可。
#
#   python trim_enemy_portraits.py            # 干员方（game_ops）没有怪物棋子，只会处理 game
#   python trim_enemy_portraits.py game       # 指定目录

import json
import os
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('需要 Pillow：pip install pillow')

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, sys.argv[1] if len(sys.argv) > 1 else 'game')
BACKUP = os.path.join(HERE, '_backup_enemy_portrait')


def main():
    chess = json.load(open(os.path.join(APP, 'data', 'chess.json'), encoding='utf-8'))
    man = json.load(open(os.path.join(APP, 'data', 'assets.json'), encoding='utf-8'))
    chars = man.get('chars') or {}
    ids = set()
    for key, rec in chess.items():
        if not key.startswith('chess_mon_'):
            continue
        pid = (rec.get('assets') or {}).get('portrait')
        if isinstance(pid, str) and pid:
            ids.add(pid)
    paths = set()
    for pid in ids:
        url = (chars.get(pid) or {}).get('portrait')
        if isinstance(url, str) and url.startswith('/assets/'):
            paths.add(url)
    os.makedirs(BACKUP, exist_ok=True)
    trimmed = skipped = 0
    for url in sorted(paths):
        f = os.path.join(APP, 'public' + url)
        if not os.path.exists(f):
            skipped += 1
            continue
        im = Image.open(f).convert('RGBA')
        box = im.getbbox()
        if not box or box[1] <= 0:
            skipped += 1
            continue
        bf = os.path.join(BACKUP, os.path.basename(f))
        if not os.path.exists(bf):
            shutil.copy2(f, bf)
        im.crop((0, box[1], im.width, box[3])).save(f)
        trimmed += 1
    print(f'裁剪 {trimmed} 张，跳过 {skipped} 张；原图备份在 {BACKUP}')


if __name__ == '__main__':
    main()
