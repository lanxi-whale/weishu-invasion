// Connect the summon records included in the 4v4 enemy table to the existing enemy hook system.
import { skill } from './archetypes.js';
import { remainingRoute, spawnChildren, stayRoute, T } from './helpers.js';

export function summonAfterDeath(battle, enemy, key, delay, count = 1, countInTotal = false) {
  if (!key || count <= 0 || !battle.data.getEnemy(key)) return;
  const route = remainingRoute(enemy);
  battle.after(Math.max(0, delay), () => {
    spawnChildren(battle, enemy, key, count, { countInTotal, route });
  }, { holdsBattle: true });
}

function splitOnDeath(ab) {
  const key = ab.tS['deathrattle.enemy_key'] ?? ab.tS['Attack.enemy_key'];
  const count = T(ab, 'deathrattle.cnt') ?? 1;
  // [ASSUMED] Replacements with only Attack.delay use that delay.
  const delay = T(ab, 'deathrattle.delay', 'Attack.delay') ?? 1;
  return [{
    death(ctx, battle, enemy) {
      if (ctx.reason === 'killed') summonAfterDeath(battle, enemy, key, delay, count, true);
    },
  }];
}

function stationaryOnDeath(ab) {
  const key = ab.tS['Summon.enemy_key'];
  const count = T(ab, 'Summon.cnt') ?? 0;
  return [{
    death(ctx, battle, enemy) {
      if (ctx.reason !== 'killed' || !key || count <= 0 || !battle.data.getEnemy(key)) return;
      spawnChildren(battle, enemy, key, count, { route: stayRoute(enemy), countInTotal: false });
    },
  }];
}

function periodicSummon(ab) {
  const cast = ab.sk.Spawn;
  const key = cast?.bs.enemy_key;
  if (!key) return [];
  return [skill(cast, (battle, enemy) => {
    if (battle.data.getEnemy(key)) spawnChildren(battle, enemy, key, cast.bb.cnt ?? 1);
  }, { sil: true })];
}

function splitAtLowHp(ab) {
  const cast = ab.sk['0'];
  const key = cast?.bs.enemy_key;
  const ratio = T(ab, '0.hp_ratio');
  if (!key || !(ratio > 0)) return [];
  return [{
    sil: true,
    iv: T(ab, '0.interval') ?? 0,
    tick(battle, enemy) {
      if (enemy.mem.didHealthSplit || !(enemy.hpRatio < ratio) || !battle.data.getEnemy(key)) return;
      const [child] = spawnChildren(battle, enemy, key, 1, { offspringKind: 'split' });
      if (!child) return;
      enemy.mem.didHealthSplit = true;
      child.mem.didHealthSplit = true;
      child.hp = child.s.maxHp * enemy.hpRatio;
    },
  }];
}

export const INVASION_SUMMON_KITS = Object.freeze({
  enemy_1131_sbeast: splitOnDeath,
  enemy_1131_sbeast_2: splitOnDeath,
  enemy_1132_sarchn: splitOnDeath,
  enemy_1132_sarchn_2: splitOnDeath,
  enemy_1222_dpvt: splitOnDeath,
  enemy_1222_dpvt_2: splitOnDeath,
  enemy_1223_dmech: splitOnDeath,
  enemy_1223_dmech_2: splitOnDeath,
  enemy_1361_dthrow: splitOnDeath,
  enemy_1361_dthrow_2: splitOnDeath,
  enemy_1360_dfello: stationaryOnDeath,
  enemy_1363_spnshd_2: stationaryOnDeath,
  enemy_1436_dsdivi: splitAtLowHp,
  enemy_1436_dsdivi_2: splitAtLowHp,
  enemy_10077_mpbarr: periodicSummon,
});
