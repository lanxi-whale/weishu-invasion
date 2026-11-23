import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from '../game/test/match/harness.js';
import { getVersionData as invasionData } from '../game/server/data.js';
import { getVersionData as allianceData } from '../game_ops/server/data.js';
import { GameData } from '../game_ops/server/match/gamedata.js';
import { applyOpsWave, buildUniteWave } from '../game_ops/server/match/waves.js';
import { Battle } from '../game_ops/server/sim/Battle.js';
import { DataSource } from '../game_ops/server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../game_ops/server/sim/spec.js';
import { spawnChildren } from '../game_ops/server/sim/content/enemies/helpers.js';
import { invadingLeak } from '../game_ops/server/sim/battle/deploy.js';

const version = 'act3autochess@V3_1';
const modeId = 'mode_single_6';
const data = allianceData(version);
const gd = new GameData(data, modeId);
const ds = new DataSource(data);
const sourcePlayerId = 'invader';

function crossCampBattles(chessId, { maxHp = 19999 } = {}) {
  const match = makeMatch({ mode: 'solo', modeId, data: invasionData(version) });
  let payload;
  try {
    match.m.round = 1;
    payload = JSON.parse(JSON.stringify(match.m._monsterWavePayload([{
      r: 16, c: 7, chessId, sourcePlayerId,
      stats: { maxHp, moveSpeed: 0 },
    }])));
  } finally { match.m.dispose(); }
  assert.equal(payload.spawns.length, 1);
  const wave = applyOpsWave({ routes: [] }, payload, gd);
  const opts = {
    seed: 1, kind: 'normal', stageId: 'act3autochess_m04', modeId, round: 1, timeLimit: 30,
    fieldId: 'summon-test', players: [], content: 'full', routes: wave.routes,
    spawns: wave.spawns.map((entry) => ({ ...entry, time: 0, count: 1 })),
  };
  return [new Battle({ ...opts, data: ds }), createBattleFromSpec(buildBattleSpec(opts), ds)];
}

function advance(battle, seconds) {
  const until = battle.time + seconds;
  while (!battle.finished && battle.time < until - 1e-9) battle.step();
  assert.equal(battle.errorCount, 0);
}

const living = (battle, key) => battle.enemies.filter((unit) => unit.alive && unit.defId === key);

test('timed invasion summoners produce their own child definition after the configured cooldown', () => {
  for (const [chessId, child, initial] of [
    ['chess_mon_enemy_10077_mpbarr', 'enemy_10073_mpcar', 3],
    ['chess_mon_enemy_1133_harchn_b', 'enemy_1138_tumor', 5],
    ['chess_mon_enemy_1321_wdarft', 'enemy_1269_nhfly', 10],
  ]) {
    for (const battle of crossCampBattles(chessId)) {
      advance(battle, initial - 0.1);
      assert.equal(living(battle, child).length, 0, chessId);
      advance(battle, 0.25);
      const kids = living(battle, child);
      assert.ok(kids.length > 0, chessId);
      assert.ok(kids.every((unit) => unit.sourcePlayerId === sourcePlayerId && unit.s.maxHp === ds.getEnemy(child).maxHp), chessId);
    }
  }
});

test('invasion death spawns execute even when the parent was the last living enemy', () => {
  for (const [chessId, child, count] of [
    ['chess_mon_enemy_1195_sfyin_b', 'enemy_1196_msfyin_2', 2],
    ['chess_mon_enemy_1133_harchn_b', 'enemy_1138_tumor', 4],
    ['chess_mon_enemy_1131_sbeast', 'enemy_1137_plasm', 2],
    ['chess_mon_enemy_1132_sarchn_b', 'enemy_1138_tumor', 3],
    ['chess_mon_enemy_1222_dpvt', 'enemy_1220_dzoms', 1],
    ['chess_mon_enemy_1223_dmech_b', 'enemy_1220_dzoms_2', 1],
    ['chess_mon_enemy_1361_dthrow_b', 'enemy_1220_dzoms_2', 1],
    ['chess_mon_enemy_1226_dklord', 'enemy_1221_dzomg', 1],
    ['chess_mon_enemy_1362_dfat_b', 'enemy_1221_dzomg_2', 1],
    ['chess_mon_enemy_1360_dfello', 'enemy_1367_dseed', 1],
    ['chess_mon_enemy_1363_spnshd_2', 'enemy_1367_dseed', 2],
  ]) {
    for (const battle of crossCampBattles(chessId)) {
      battle.step();
      const [parent] = battle.enemies;
      battle.kill(parent);
      advance(battle, 1.25);
      const kids = living(battle, child);
      assert.equal(kids.length, count, chessId);
      assert.ok(kids.every((unit) => unit.sourcePlayerId === sourcePlayerId && !unit.inTotal), chessId);
    }
  }
});

test('invasion health-triggered split spawns once and its child cannot split again', () => {
  const key = 'enemy_1436_dsdivi_2';
  for (const battle of crossCampBattles('chess_mon_enemy_1436_dsdivi_b')) {
    battle.step();
    const [parent] = living(battle, key);
    battle.dealHPLose({ target: parent, amount: parent.hp / 2 + 1 });
    advance(battle, 1);
    const clone = living(battle, key).find((unit) => unit !== parent);
    assert.ok(clone);
    assert.ok(Math.abs(clone.hpRatio - parent.hpRatio) < 1e-9);
    assert.equal(clone.sourcePlayerId, sourcePlayerId);
    assert.equal(clone.inTotal, false);
    advance(battle, 1);
    assert.equal(living(battle, key).length, 2);
  }
});

test('invading children that reach the blue gate count in both battle phases', () => {
  const defender = 'blue';
  for (const kind of ['normal', 'unite']) {
    const opts = {
      seed: 1, kind, stageId: 'act3autochess_m04', modeId, round: 1, timeLimit: 20,
      flags: { duelGateLeaks: true }, players: [{ playerId: defender, units: [], bonds: {} }], content: 'full',
      routes: [{ motion: 'WALK', start: [12, 8], end: [12, 8], steps: [{ t: 'wait', s: 60 }] }],
      spawns: [{ enemyKey: 'enemy_1422_lrsldr', sourcePlayerId, time: 0, routeIndex: 0 }],
    };
    const battle = new Battle({ ...opts, data: ds });
    battle.step();
    const [parent] = battle.enemies;
    const exit = { motion: 'WALK', start: [12, 8], end: [12, 7], checkpoints: [] };
    const [entered] = spawnChildren(battle, parent, 'enemy_1138_tumor', 1, { route: exit, countInTotal: false });
    const [waiting] = spawnChildren(battle, parent, 'enemy_1138_tumor', 1, { countInTotal: false });
    const [defending] = spawnChildren(battle, { ...parent, sourcePlayerId: defender }, 'enemy_1138_tumor', 1, { route: exit });
    assert.ok(entered && waiting && defending);
    assert.equal(battle.total, 1);
    advance(battle, 10);
    assert.equal(entered.alive, false);
    assert.equal(defending.alive, false);
    assert.equal(waiting.alive, true);
    battle.kill(parent);
    battle.forceEnd('timeout');
    const { leaked } = battle.result().perPlayer[defender];
    assert.equal(battle.snapshot().gateLeaks, 1);
    assert.equal(leaked.filter(leak => invadingLeak(leak, defender)).length, 1);
    assert.equal(leaked.find(leak => invadingLeak(leak, defender)).goalReached, true);
  }
});

test('a summon that entered the gate carries the breach into a joint timeout', () => {
  const blue = 'defender';
  const leaker = 'original-lane';
  const wave = buildUniteWave(gd, [{ enemyKey: 'enemy_1138_tumor', mods: null, sourcePlayerId: leaker,
    invasionSummon: true, countInTotal: false, reenteredAfterGoal: true }], 1, 1);
  assert.equal(wave.spawns.length, 1);
  const battle = new Battle({ data: ds, seed: 1, kind: 'unite', stageId: 'act3autochess_m04', modeId, round: 1, timeLimit: 2,
    flags: { duelGateLeaks: true }, players: [{ playerId: blue, units: [], bonds: {} }],
    routes: wave.routes, spawns: [{ ...wave.spawns[0], time: 0 }] });
  battle.step();
  assert.ok(battle.enemies.some(e => e.alive));
  battle.forceEnd('timeout');
  const result = battle.result().perPlayer[blue].leaked[0];
  assert.equal(result.goalReached, false);
  assert.equal(result.reenteredAfterGoal, true);
  assert.equal(invadingLeak(result, blue), true);
  assert.equal(battle.snapshot().gateLeaks, 0);
});
