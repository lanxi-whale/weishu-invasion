# 卫戍协议：侵略 · Stronghold Protocol: Invasion

> 本项目以 B 站 UP 主 **Ausevay** 的作品《卫戍协议：盟约》为基础二次创作。
>
> - 原视频：<https://www.bilibili.com/video/BV1QoaU6gEF2>
> - 原作者仓库：<https://github.com/sganggs/Stronghold-Protocol>
>
> 「盟约」的代码、玩法设计与美术资产版权归原作者 Ausevay 所有；本仓库只做**非官方同人延伸**，不是原作，也不代表原作者立场。请先看上面的原视频和原仓库。

《明日方舟》季节性自走棋塔防玩法「卫戍协议」的**非官方同人二次创作**。

本仓库包含两部分：

- `game/` —— **Ausevay《卫戍协议：盟约》的浏览器端实现**（单人或 1–4 人联机合作），GPL-3.0，来自原作者仓库的版本。
- 仓库根目录 —— 我们在它基础上做的「**侵略**」改造：敌方阵营、怪物图鉴生成、入侵玩法相关的构建脚本，以及解码出来的官方数据表。

> [!IMPORTANT]
> 本项目是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方没有任何关系，未获其授权或认可。

## 目录

| 路径 | 内容 |
|---|---|
| `game/` | 游戏本体（来自 Ausevay 的《卫戍协议：盟约》：前端 `public/`、服务端 `server/`、工具 `tools/`、测试 `test/`、文档 `docs/`） |
| `data/` | 玩法数据 |
| `bridge/` | 与客户端桥接的工具 |
| `怪物图鉴/`、`怪物总表/` | 「侵略」用的怪物阵营资料 |
| `gen_monster_faction.py`、`gen_game_monsters.py`、`gen_bestiary_data.py` | 生成怪物/图鉴数据 |
| `invasion-*.css`、`invasion_emblems.py`、`build-invasion-*.py` | 侵略玩法的界面与图标构建 |
| `draw-kazdel-court.py`、`build-kazdel-wireframe.py` | 场景绘制脚本 |
| `decode-client-tables.py`、`import-official-data.mjs` | 官方数据表解码与导入 |
| `官方地图.md`、`官方数据接入.md`、`设计稿.md`、`飞行寻路.md` | 设计与接入说明 |

## 运行

游戏本体需要 Node 22 或 24：

```bash
cd game
npm install
npm run dev
```

具体端口、联机与部署方式见 `game/README.md` 与 `game/Dockerfile`。

## 素材

美术与音频素材（`game/public/assets/`，约 1.5 GB）**不在本仓库**，见 [Releases](../../releases) 页面的素材包。

## 授权

- **原作**《卫戍协议：盟约》的代码与素材版权归 **Ausevay**（<https://github.com/sganggs/Stronghold-Protocol>），沿用 **GPL-3.0-or-later**（见 `game/LICENSE`）。
- 本仓库新增的「侵略」相关脚本与数据同样以 **GPL-3.0-or-later** 发布。
- 第三方库与素材的授权见 `game/THIRD-PARTY-NOTICES.md` 与 `game/NOTICE.md`。
- 同人作品，仅供学习与玩家交流，不做商业用途；如需使用原作素材，请遵守原作者仓库的授权与说明。
