// server/match/monsterWave.js — 4v4 怪物阵营：把玩家在 pen 上摆的阵容变成当轮的出怪波次
//
// 规则（与 4v4/rules 一致）：
//   * 每个棋子 → 一个 SpawnSpec，count 是该单位实际包含的怪物数量
//   * 批次按距最近红门的距离划分。进门时间由该距离和当回合移速决定。
//   * 盟约红门保持进门顺序，所有相邻怪物的进门间隔放大到 3 倍。
//
// 4v4 合并服务器后：波次先写进程内的 globalThis.__SP_WAVE__（干员方在同一个进程里直接读，立即生效），
// 同时仍然写 bridge/wave.json —— 两台分开起的时候也能用。

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OPERATOR_GATES } from '../../../bridge/gates.js';
import { MOVE_SCALE } from '../sim/constants.js';
import { COMBAT_TIME_SCALE } from './gamedata.js';
import { monsterSpawnInterval, sizeMonsterLineup } from './monsterUnits.js';

const ALLIANCE_FIRST_SPAWN = 1.2;
const ALLIANCE_INTERVAL_SCALE = 3;

const roundSeconds = seconds => Math.round(seconds * 1000) / 1000;

export function gateEntryTime(distance, moveSpeed) {
  const speed = Number.isFinite(moveSpeed) && moveSpeed > 0 ? moveSpeed : 0.7;
  const seconds = distance / (speed * MOVE_SCALE * 2);
  return roundSeconds(Math.max(0.3, Math.min(5, seconds)));
}

/** Transfer the real-time gaps into the defender's battle clock. */
export function allianceSpawnSchedule(entries, combatTimeScale = COMBAT_TIME_SCALE) {
  if (!entries.length) return [];
  const firstEntry = Math.min(...entries.map(entry => entry.time));
  return entries.map(entry => ({
    ...entry,
    time: roundSeconds((ALLIANCE_FIRST_SPAWN + (entry.time - firstEntry) * ALLIANCE_INTERVAL_SCALE) * combatTimeScale),
    interval: entry.interval * ALLIANCE_INTERVAL_SCALE * combatTimeScale,
  })).sort((a, b) => a.time - b.time);
}

/** 跨阵营的波次文件（分开起服务器时的通道） */
export const BRIDGE_FILE = fileURLToPath(new URL('../../../bridge/wave.json', import.meta.url));
/** 进程内的波次总线：两个阵营在同一个 node 进程里时用它，比文件快且没有时序问题 */
export const WAVE_BUS_KEY = '__SP_WAVE__';

/** 发布一份波次：进程内总线 + 文件（都失败也不影响本局） */
export function publishWave(payload) {
  try { globalThis[WAVE_BUS_KEY] = payload; } catch { /* ignore */ }
  try {
    fs.writeFileSync(BRIDGE_FILE, JSON.stringify(payload), 'utf8');
  } catch { /* ignore */ }
  return payload;
}

/**
 * 备战棋盘上的两个红门（用于给阵容分批；真正的出怪点用干员地图的红门）。
 * 注意：行号是向上增长的，所以 16 行在屏幕上方、13 行在下方。
 * 下标 0 = 上门（[16,7]）、下标 1 = 下门（[13,7]）——波次里的 preview.gate 就按这个下标算。
 */
export const MONSTER_GATES = Object.freeze([[16, 7], [13, 7]]);
/** 观战用的干员战场：关卡 id 与取景矩形 */
export const OPS_STAGE_ID = 'act3autochess_ops01';
export const OPS_RECT = Object.freeze({ r0: 9, r1: 12, c0: 0, c1: 10 });
export const MONSTER_ROUTES = Object.freeze([
  // 上门（行号大的在上面）：进战场后沿上排走到右侧，再折向左下，最后从左侧离场
  Object.freeze({ motion: 'WALK', start: [16, 7], end: [17, 3], checkpoints: [[16, 12], [17, 12], [17, 4]] }),
  // 下门：沿下排直接向左
  Object.freeze({ motion: 'WALK', start: [13, 7], end: [13, 3], checkpoints: [[13, 5]] }),
]);

/** Resolve a card to its battle enemy, including native elite variants. */
export function enemyKeyOfChess(chessId, gd = null) {
  const s = String(chessId || '');
  if (!s.startsWith('chess_mon_')) return null;
  const base = s.slice('chess_mon_'.length).replace(/_b$/, '');
  const assets = gd?.chess?.(s)?.assets;
  const variant = assets?.avatar;
  if (s.endsWith('_b') && typeof variant === 'string' && variant.startsWith(base + '_') && gd.enemy?.(variant)) return variant;
  return assets?.spine || base;
}

/** Group deployments by their nearest gate's distance and retain the gate index for both maps. */
export function rankLineup(lineup, gates) {
  const gs = (Array.isArray(gates) ? gates : []).filter((g) => g && Number.isFinite(g.r) && Number.isFinite(g.c));
  const use = gs.length ? gs : [{ r: 0, c: 0 }];
  const clean = (Array.isArray(lineup) ? lineup : []).filter((p) => p && Number.isInteger(p.r) && Number.isInteger(p.c));
  const withDist = clean.map((p) => {
    let dist = Infinity, gateIndex = 0;
    for (const [i, g] of use.entries()) {
      const distance = Math.abs(p.r - g.r) + Math.abs(p.c - g.c);
      if (distance < dist) { dist = distance; gateIndex = i; }
    }
    return { ...p, dist, gateIndex };
  });
  const dists = [...new Set(withDist.map((p) => p.dist))].sort((a, b) => a - b);
  return withDist
    .map((p) => ({ ...p, batch: dists.indexOf(p.dist) + 1 }))
    .sort((a, b) => (a.batch - b.batch) || (a.r - b.r) || (a.c - b.c));
}

/**
 * 用玩家阵容替换波次里的 spawns。
 * @param {object} base buildNormalWave 的结果（routes / timeLimit / overrides 等继续沿用）
 * @param {Array<{r:number,c:number,chessId:string}>} lineup
 * @param {object|null} gd
 * @param {string[]} disabledBonds
 * @returns {object} 新的 wave
 */
export function waveFromLineup(base, lineup, gd = null, disabledBonds = []) {
  // 分批仍按备战棋盘的红门距离；两端保持上门对应上门、下门对应下门。
  const penGates = MONSTER_GATES.map(([r, c]) => ({ r, c }));
  const gates = OPERATOR_GATES.map(([r, c]) => ({ r, c }));
  const routes = (base.routes || []).slice();
  const ranked = sizeMonsterLineup(rankLineup(lineup, penGates), gd, disabledBonds);

  const spawns = [];
  for (const p of ranked) {
    const enemyKey = enemyKeyOfChess(p.chessId, gd);
    if (!enemyKey) continue;
    const gi = p.gateIndex;
    const g = gates[gi];
    let routeIndex = routes.findIndex((r) => r && r.motion === 'WALK' && r.start?.[0] === g.r && r.start?.[1] === g.c);
    if (routeIndex < 0) {
      routes.push({ motion: 'WALK', start: [g.r, g.c], end: [9, 2], checkpoints: [] });
      routeIndex = routes.length - 1;
    }
    spawns.push({
      time: gateEntryTime(p.dist, p.stats?.moveSpeed ?? gd?.chess(p.chessId)?.stats?.moveSpeed),
      enemyKey,
      ...(p.stats ? { stats: { ...p.stats } } : {}),
      routeIndex,
      pos: [g.r, g.c],
      count: p.count,
      interval: monsterSpawnInterval,
      sourcePlayerId: p.sourcePlayerId ?? null,
      invasionBonds: p.invasionBonds,
      mods: { hpMul: 1, atkMul: 1, speedMul: 1, slot: 'N' },
      actionIndex: 0,
      preview: { gate: gi === 0 ? 'upper' : 'lower', start: [g.r, g.c], fly: false, elite: false, boss: false },
      lineup: { r: p.r, c: p.c, batch: p.batch },
    });
  }
  return { ...base, pick: null, spawns: allianceSpawnSchedule(spawns, gd?.combatTimeScale), routes, actions: [] };
}
