import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../game_ops/server/data.js';
import { getVersionData as monsterData } from '../game/server/data.js';
import { GameData } from '../game_ops/server/match/gamedata.js';
import { GameData as MonsterData } from '../game/server/match/gamedata.js';
import { applyOpsWave, previewOf } from '../game_ops/server/match/waves.js';
import { MatchCombat } from '../game/server/match/match/combat.js';
import { VERSIONS } from '../game_ops/shared/versions.js';
import { DataSource, normalizeRoute } from '../game_ops/server/sim/simdata.js';
import { makeBattle } from '../game_ops/test/helpers/battleHarness.js';
import { remainingDistance } from '../game_ops/server/sim/ai.js';
import { MOVE_SCALE, TICK } from '../game_ops/server/sim/constants.js';
import { SoloOpponent } from '../bridge/soloOpponent.js';
import { makeMatch as monsterMatch } from '../game/test/match/harness.js';
import { makeMatch as operatorMatch } from '../game_ops/test/match/harness.js';

const version = 'act3autochess@V3_1';
const raw = getVersionData(version);
const gd = new GameData(raw, 'mode_single_6');
const drone = 'enemy_1005_yokai';
const walker = 'enemy_1422_lrsldr';
const spawn = (enemyKey, gate, fly = false) => ({ enemyKey, time: 0, preview: { gate, fly } });

test('bridge selects official flight routes for both gates in every version and normal round', () => {
  for (const v of VERSIONS) {
    const data = new GameData(getVersionData(v.id), v.family === 'regulation' ? 'mode_single_6' : 'mode_single_normal');
    for (let round = 1; round <= 14; round++) {
      const tpl = data.wave(data.roundCfg(round)?.template);
      if (!tpl) continue;
      const original = structuredClone(tpl.routes);
      const wave = applyOpsWave(tpl, { spawns: [
        spawn(drone, 'upper'), spawn(drone, 'lower'),
        spawn(walker, 'upper', true), spawn(walker, 'lower', true),
      ] }, data);
      for (const s of wave.spawns) {
        const fly = s.enemyKey === drone;
        const route = wave.routes[s.routeIndex];
        assert.equal(s.preview.fly, fly, `${v.id}/R${round}: official motion beats stale preview`);
        assert.equal(route.motion === 'FLY', fly);
        assert.deepEqual(route.start, s.pos);
        if (fly) {
          const official = original.find((r) => r.motion === 'FLY' && r.start.join() === s.pos.join())
            || original.find((r) => r.motion === 'FLY');
          assert.ok(official, `${v.id}/R${round}: official flight route exists`);
          assert.deepEqual(route.checkpoints, official.checkpoints);
          assert.deepEqual(route.end, official.end);
          assert.equal(s.mods.slot, 'NF');
        }
      }
      assert.deepEqual(tpl.routes, original, 'bridge does not mutate official template data');
      const refreshed = applyOpsWave(wave, { spawns: wave.spawns }, data);
      assert.equal(refreshed.routes.length, wave.routes.length, 'repeated prep polling does not add more routes');
    }
  }
});

test('official R1 flight checkpoints remain ordered on all ten real terrains, without direct goal shortcuts', () => {
  // Pinned official level_act3autochess_01, translated by layouts.mjs (+9 rows, +2 cols).
  const checkpoints = [[9, 9], [12, 9], [12, 7], [9, 7], [9, 5], [12, 5], [12, 4], [9, 4]];
  const wave = applyOpsWave(raw.waves.act3autochess_01, { spawns: [spawn(drone, 'upper'), spawn(drone, 'lower')] }, gd);
  const data = new DataSource(raw);
  for (const stageId of raw.config.mapRotation) for (const s of wave.spawns) {
    const route = wave.routes[s.routeIndex];
    assert.deepEqual(route.checkpoints, checkpoints);
    const h = makeBattle({ data, stageId, routes: wave.routes, content: 'none', timeLimit: 400,
      enemies: [{ key: drone, routeIndex: s.routeIndex, pos: s.pos }] });
    h.step();
    const enemy = h.enemies()[0];
    assert.equal(enemy.motion, 'FLY');
    const direct = Math.hypot(route.end[0] - s.pos[0], route.end[1] - s.pos[1]);
    assert.ok(remainingDistance(h.b, enemy) > direct + 10, 'checkpoint detours count toward distance to goal');
    const legs = normalizeRoute(route).checkpoints;
    for (let i = 0; i < legs.length; i++) {
      for (let tick = 0; tick < 2000 && enemy.alive && enemy.route.legIdx <= i; tick++) h.step();
      assert.ok(enemy.alive, `${stageId}: flyer cannot leak before checkpoint ${i}`);
      const [r, c] = legs[i].pos;
      const error = Math.hypot(enemy.x - c, enemy.y - r);
      assert.ok(error <= enemy.s.moveSpeed * MOVE_SCALE * TICK + 1e-6, `${stageId}: missed turn ${i}: ${error}`);
    }
    h.run(60);
    assert.equal(h.hooksOf('enemyLeak').length, 1, `${stageId}: flyer reaches goal after all checkpoints`);
    assert.equal(h.result().resolved, 1);
    assert.equal(h.result().errors || 0, 0);
  }
});

test('monster payload and defender preview preserve flight identity, including native two-star variants', () => {
  const mon = new MonsterData(monsterData(version), 'mode_single_6');
  const cards = Object.values(mon.raw.chess).filter((c) => c.assets?.spine?.startsWith(drone));
  assert.ok(cards.some((c) => /_b$/.test(c.chessId)), 'include a two-star flyer');
  const lineup = cards.map((c, i) => ({ r: i % 2 ? 13 : 16, c: 8, chessId: c.chessId }));
  const match = Object.assign(Object.create(MatchCombat.prototype), { gd: mon, round: 1, players: new Map() });
  const payload = match._monsterWavePayload(lineup);
  assert.equal(payload.spawns.length, cards.length);
  assert.ok(payload.spawns.every((s) => s.preview.fly && s.mods.slot.endsWith('F')));
  const wave = applyOpsWave(raw.waves.act3autochess_01, payload, gd);
  assert.ok(previewOf(wave.spawns).every((s) => s.fly));
});

test('hovering ground movers retain WALK routes despite being airborne targets', () => {
  const key = 'enemy_2025_syufo'; // 掠海漂移体: targeting flight is not pathfinding flight.
  assert.equal(gd.enemy(key).stats.motion, 'WALK');
  const wave = applyOpsWave(raw.waves.act3autochess_01, { spawns: [spawn(key, 'upper', true)] }, gd);
  assert.equal(wave.spawns[0].preview.fly, false);
  assert.equal(wave.routes[wave.spawns[0].routeIndex].motion, 'WALK');
  const h = makeBattle({ data: new DataSource(raw), routes: wave.routes, enemies: [{ key, routeIndex: wave.spawns[0].routeIndex }] });
  h.step();
  assert.equal(h.enemies()[0].isFlying, true);
  assert.equal(h.enemies()[0].motion, 'WALK');
});

test('both solo camp adapters preserve official flight checkpoints with real AI opponents', () => {
  const owner = monsterMatch({ mode: 'solo', seed: 673 });
  const defender = new SoloOpponent(owner.m, 'ops');
  try {
    const battle = defender.operatorBattle(1, { spawns: [spawn(drone, 'upper'), spawn(drone, 'lower')] });
    battle.step();
    const enemies = battle.enemies.filter((e) => e.defId === drone);
    assert.equal(enemies.length, 2);
    for (const e of enemies) {
      assert.equal(e.motion, 'FLY');
      assert.equal(e.route.legs.length, 9, 'eight official checkpoints followed by the goal');
    }
    assert.equal(battle.errorCount, 0);
  } finally { defender.dispose(); owner.m.dispose(); }

  const ops = operatorMatch({ mode: 'solo', seed: 673 });
  const attacker = new SoloOpponent(ops.m, 'monster');
  try {
    const m = attacker.prepare(1);
    const card = Object.values(m.gd.raw.chess).find((c) => c.assets?.spine === drone);
    assert.ok(card);
    m._monsterLineup = () => [{ r: 16, c: 8, chessId: card.chessId }];
    const wave = attacker.monsterWave(1, raw.waves.act3autochess_01);
    assert.equal(wave.spawns.length, 1);
    assert.equal(wave.spawns[0].preview.fly, true);
    assert.deepEqual(wave.routes[wave.spawns[0].routeIndex].checkpoints, raw.waves.act3autochess_01.routes[2].checkpoints);
  } finally { attacker.dispose(); ops.m.dispose(); }
});
