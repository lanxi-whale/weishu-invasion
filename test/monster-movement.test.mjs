import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, legalTileFor } from '../game/test/match/harness.js';
import { getVersionData as monsterData } from '../game/server/data.js';
import { getVersionData } from '../game_ops/server/data.js';
import { GameData } from '../game_ops/server/match/gamedata.js';
import { applyOpsWave } from '../game_ops/server/match/waves.js';
import { DataSource } from '../game_ops/server/sim/simdata.js';
import { Battle } from '../game_ops/server/sim/Battle.js';
import { Battle as MonsterBattle } from '../game/server/sim/Battle.js';
import { flatStage } from '../game_ops/test/helpers/battleHarness.js';
import { buildBattleSpec, createBattleFromSpec } from '../game_ops/server/sim/spec.js';
import { OPS_RECT } from '../game/server/match/monsterWave.js';

const version = 'act3autochess@V3_1';
const raw = getVersionData(version);
const gd = new GameData(raw, 'mode_single_6');
const ds = new DataSource(raw);

test('both preparation engines keep monster speed modifiers while operators and preparation pieces stay in place', () => {
  const data = new DataSource(monsterData(version));
  for (const Engine of [Battle, MonsterBattle]) {
    const b = new Engine({ data, stage: flatStage(), rect: OPS_RECT, kind: 'normal', content: 'none', timeLimit: 10,
      players: [{ playerId: 'p', coords: 'field', units: [
        { uid: 1, chessId: 'chess_mon_enemy_1131_sbeast', row: 9, col: 4 },
        { uid: 2, chessId: 'chess_char_1_01_a', row: 9, col: 5 },
      ] }], spawns: [], routes: [], autoFinish: false });
    b.start();
    const monster = b.allyUnits.find((u) => u.uid === 1);
    const operator = b.allyUnits.find((u) => u.uid === 2);
    assert.ok(monster.deployed && operator.deployed);
    assert.equal(monster.s.moveSpeed, 1.7);
    assert.equal(operator.s.moveSpeed, 0);
    b.addBuff(monster, { key: 'test:speed', mods: { moveFlat: 0.3, moveMul: 1.5 } });
    assert.equal(monster.s.moveSpeed, 3);
    for (let i = 0; i < 60; i++) b.step();
    assert.deepEqual([monster.y, monster.x], [9, 4]);
    assert.deepEqual([operator.y, operator.x], [9, 5]);
    assert.equal(b.errorCount, 0);
  }
});

test('real prepared ground and flying monsters retain native speed and move after the round-four spawns', () => {
  const h = makeMatch({ mode: 'solo', data: monsterData(version), modeId: 'mode_single_6', seed: 673 });
  try {
    h.autoHumans().start().runToPhase('PREP', 1);
    const m = h.m, ps = m.order[0];
    ps.autoplay = false;
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
    const ids = ['chess_mon_enemy_1005_yokai', 'chess_mon_enemy_1131_sbeast',
      'chess_mon_enemy_1000_gopro_2', 'chess_mon_enemy_1017_defdrn_b',
      'chess_mon_enemy_1067_snslime', 'chess_mon_enemy_10083_hlbird'];
    for (const id of ids) give(m, ps, id, 'board', legalTileFor(m, ps, id));
    m.round = 4;
    const lineup = m._monsterLineup();
    for (const p of lineup) {
      assert.equal(p.stats.moveSpeed, m.gd.chess(p.chessId).stats.moveSpeed, p.chessId);
      assert.ok(p.stats.moveSpeed > 0, `${p.chessId}: preparation must not zero movement`);
    }
    const payload = JSON.parse(JSON.stringify(m._monsterWavePayload(lineup)));
    const wave = applyOpsWave(raw.waves.act3autochess_04, payload, gd);
    for (const stageId of raw.config.mapRotation) {
      const opts = { seed: 1, kind: 'normal', stageId, rect: OPS_RECT, round: 4,
        modeId: 'mode_single_6', timeLimit: 90, players: [], content: 'full',
        routes: wave.routes, enemyOverrides: wave.overrides,
        spawns: wave.spawns.map((s) => ({ ...s, time: 0 })) };
      // Both the authoritative server and the browser's serialized input must walk.
      for (const b of [new Battle({ ...opts, data: ds }), createBattleFromSpec(buildBattleSpec(opts), ds)]) {
        b.start(); b.step();
        assert.equal(b.enemies.length, ids.length);
        const enemies = b.enemies.slice();
        for (let i = 0; i < 240 && !b.finished; i++) b.step();
        for (const e of enemies) {
          assert.ok(e.x !== e.spawnX || e.y !== e.spawnY, `${stageId}/${e.defId}: stayed at red gate`);
          assert.ok(e.route.legIdx > 0 || e.route.ptIdx > 0 || e.moving || !e.alive,
            `${stageId}/${e.defId}: no route progress`);
        }
        assert.equal(b.errorCount, 0, stageId);
      }
    }
  } finally { h.m.dispose(); }
});
