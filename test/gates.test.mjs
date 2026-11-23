import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../game_ops/server/data.js';
import { getVersionData as monsterData } from '../game/server/data.js';
import { GameData } from '../game_ops/server/match/gamedata.js';
import { GameData as MonsterData } from '../game/server/match/gamedata.js';
import { MatchCombat } from '../game/server/match/match/combat.js';
import { waveFromLineup } from '../game/server/match/monsterWave.js';
import { applyOpsWave, previewOf } from '../game_ops/server/match/waves.js';
import { gateOf } from '../game_ops/shared/constants.js';
import { groupEnemies } from '../game_ops/public/js/ui/gameLogic/enemies.js';
import { DataSource } from '../game_ops/server/sim/simdata.js';
import { makeBattle } from '../game_ops/test/helpers/battleHarness.js';

const version = 'act3autochess@V3_1';
const raw = getVersionData(version);
const gd = new GameData(raw, 'mode_single_6');
const mon = new MonsterData(monsterData(version), 'mode_single_6');
const walker = 'enemy_1422_lrsldr';
const flyer = 'enemy_1005_yokai';
const card = (key) => Object.values(mon.raw.chess).find((c) => c.assets?.spine === key && !/_b$/.test(c.chessId)).chessId;
const lineup = [
  { r: 16, c: 8, chessId: card(walker) },
  { r: 16, c: 9, chessId: card(flyer) },
  { r: 13, c: 8, chessId: card(walker) },
  { r: 13, c: 9, chessId: card(flyer) },
];

test('monster upper/lower entrances stay upper/lower through payload, routes, preview and actual spawns', () => {
  const match = Object.assign(Object.create(MatchCombat.prototype), { gd: mon, round: 1, players: new Map() });
  const payload = match._monsterWavePayload(lineup);
  assert.equal(payload.spawns.length, 4);
  for (const s of payload.spawns) {
    assert.deepEqual(s.preview.start, s.preview.gate === 'upper' ? [16, 7] : [13, 7]);
  }
  // R1 lacks the upper flight route; R4 has both: check generated and official routes.
  for (const id of ['act3autochess_01', 'act3autochess_04']) {
    const wave = applyOpsWave(raw.waves[id], payload, gd);
    for (const s of wave.spawns) {
      const expected = s.preview.gate === 'upper' ? [12, 10] : [9, 10];
      assert.deepEqual(s.pos, expected, `${s.enemyKey}: same visual gate across camps`);
      assert.deepEqual(wave.routes[s.routeIndex].start, expected);
      assert.deepEqual(s.preview.start, expected);
      assert.equal(gateOf(s.pos), s.preview.gate, 'preview names agree with official gate coordinates');
    }
    const grouped = groupEnemies(previewOf(wave.spawns));
    assert.equal(grouped.filter((s) => s.gate === 'upper').length, 2);
    assert.equal(grouped.filter((s) => s.gate === 'lower').length, 2);
    const h = makeBattle({ data: new DataSource(raw), stageId: 'act3autochess_m05', content: 'none',
      routes: wave.routes, enemies: wave.spawns.map((s) => ({ key: s.enemyKey, time: 0, pos: s.pos, routeIndex: s.routeIndex })) });
    h.step();
    const enemies = h.enemies().sort((a, b) => a.spawnSeq - b.spawnSeq);
    assert.equal(enemies.length, 4);
    enemies.forEach((e, i) => {
      const gate = wave.spawns[i].preview.gate;
      assert.equal(e.spawnY, gate === 'upper' ? 12 : 9, 'actual unit appears at the matching gate');
      assert.equal(e.spawnX, 10);
    });
    assert.equal(h.b.errorCount, 0);
  }
});

test('lineup conversion uses gate identity instead of template action order or missing starts', () => {
  for (const routes of [[], [
    { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] },
  ], [
    { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] },
    { motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] },
  ]]) {
    const base = { routes, spawns: [{ preview: { start: [9, 10] } }] };
    const original = structuredClone(base);
    const wave = waveFromLineup(base, lineup.filter((p) => p.chessId === card(walker)));
    assert.equal(wave.spawns.length, 2);
    for (const s of wave.spawns) {
      const expected = s.lineup.r === 16 ? [12, 10] : [9, 10];
      assert.deepEqual(s.pos, expected);
      assert.deepEqual(wave.routes[s.routeIndex].start, expected);
      assert.deepEqual(s.preview.start, expected);
      assert.equal(s.preview.gate, gateOf(expected));
    }
    assert.deepEqual(base, original);
  }
});
