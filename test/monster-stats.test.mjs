import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, legalTileFor } from '../game/test/match/harness.js';
import { getVersionData as monsterData } from '../game/server/data.js';
import { getVersionData } from '../game_ops/server/data.js';
import { GameData } from '../game_ops/server/match/gamedata.js';
import { applyOpsWave } from '../game_ops/server/match/waves.js';
import { DataSource } from '../game_ops/server/sim/simdata.js';
import { Battle } from '../game_ops/server/sim/Battle.js';
import { buildBattleSpec, createBattleFromSpec, compactResult, resultDigest } from '../game_ops/server/sim/spec.js';
import { planUnite } from '../game_ops/server/match/unite.js';
import { buildUniteWave } from '../game_ops/server/match/waves.js';
import { validateClientResult } from '../game_ops/server/match/fields.js';
import { OPS_RECT } from '../game/server/match/monsterWave.js';
import { Battle as MonsterBattle } from '../game/server/sim/Battle.js';
import { grantInvasionBonus } from '../game/server/match/monsterBonuses.js';

const version = 'act3autochess@V3_1';
const raw = getVersionData(version);
const gd = new GameData(raw, 'mode_single_6');
const ds = new DataSource(raw);

function defender(wave) {
  return { seed: 1, kind: 'normal', stageId: 'act3autochess_m05', rect: OPS_RECT,
    round: 1, modeId: 'mode_single_6', timeLimit: 90, players: [], content: 'full',
    routes: wave.routes, spawns: wave.spawns.map((s) => ({ ...s, time: 0 })), enemyOverrides: wave.overrides };
}

function checkStats(enemy, source) {
  for (const k of ['maxHp', 'atk', 'def', 'res', 'aspd', 'bat', 'moveSpeed']) {
    assert.equal(enemy.s[k], source[k], `${enemy.defId}.${k}`);
  }
  assert.equal(enemy.s.hpRegen, source.hpRecoveryPerSec);
  assert.equal(enemy.hp, source.maxHp);
  assert.equal(enemy.s.interval, source.bat * 100 / source.aspd);
}

test('invasion preparation cards show the attributes of the monsters this round actually spawns', () => {
  const h = makeMatch({ mode: 'solo', data: monsterData(version), modeId: 'mode_single_6' });
  try {
    h.autoHumans().start().runToPhase('PREP', 1);
    const m = h.m, ps = m.order[0];
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
    const balloonId = 'chess_mon_enemy_10040_cnvbln';
    const fighterId = 'chess_mon_enemy_10054_cjhot_b';
    const pieces = [balloonId, fighterId].map((id) => give(m, ps, id, 'board', legalTileFor(m, ps, id)));
    grantInvasionBonus(ps, 'invasion_drill');
    for (const [round, expectedHp] of [[1, 3780], [14, 18480]]) {
      m.round = round;
      assert.equal(m.handle(ps.playerId, { t: 'g.unitStats', seq: round }).ok, true);
      const stats = h.lastTo(ps.playerId, 'm.unitStats').units;
      const balloon = stats.find((entry) => entry.uid === pieces[0].uid);
      assert.equal(balloon.base.maxHp, 2000);
      assert.equal(balloon.maxHp, expectedHp, `round ${round} balloon HP`);
      assert.equal(balloon.hp, balloon.maxHp);
      const wave = m._monsterWavePayload(m._monsterLineup());
      const fighter = stats.find((entry) => entry.uid === pieces[1].uid);
      const spawn = wave.spawns.find((s) => s.enemyKey.startsWith('enemy_10054_cjhot'));
      assert.ok(spawn);
      for (const key of ['maxHp', 'atk', 'def']) assert.equal(fighter[key], Math.round(spawn.stats[key]), `round ${round} ${key}`);
    }
  } finally { h.m.dispose(); }
});

test('prepared attributes survive stars, invasion bonuses, bridge JSON, queue and browser BattleSpec per piece', () => {
  const h = makeMatch({ mode: 'solo', data: monsterData(version), modeId: 'mode_single_6' });
  try {
    h.autoHumans().start().runToPhase('PREP', 1);
    const m = h.m, ps = m.order[0];
    ps.autoplay = false;
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
    const ids = ['chess_mon_enemy_10054_cjhot', 'chess_mon_enemy_10054_cjhot_b',
      'chess_mon_enemy_1005_yokai_b', 'chess_mon_enemy_1435_dsflys_b', 'chess_mon_enemy_1305_mhslim_b'];
    const pieces = ids.map((id) => give(m, ps, id, 'board', legalTileFor(m, ps, id)));
    const before = m._monsterLineup();
    grantInvasionBonus(ps, 'invasion_drill');
    const lineup = m._monsterLineup();
    assert.equal(lineup.length, ids.length);
    const prepared = new Map(lineup.map((p) => [p.uid, p.stats]));
    const buffed = prepared.get(pieces[1].uid);
    assert.ok(buffed.atk > before.find((p) => p.uid === pieces[1].uid).stats.atk);
    assert.notEqual(buffed.atk, Math.round(buffed.atk), 'wire values retain fractional ATK');
    const payload = JSON.parse(JSON.stringify(m._monsterWavePayload(lineup)));
    assert.equal(payload.spawns[0].sourcePlayerId, ps.playerId);
    assert.ok(payload.spawns.some((s) => s.enemyKey === 'enemy_1005_yokai_2'), 'native two-star identity');
    assert.ok(payload.spawns.some((s) => s.enemyKey === 'enemy_1305_mhslim_2'), 'local-only native two-star identity');
    const expected = payload.spawns.flatMap((s) => Array.from({ length: s.count }, (_, index) => ({
      time: index * s.interval, stats: s.stats,
    }))).sort((left, right) => left.time - right.time);
    const wave = applyOpsWave(raw.waves.act3autochess_01, payload, gd);
    // A scripted stage override must lose to the actual monster piece, even at round 1.
    wave.overrides = Object.fromEntries(payload.spawns.map((s) => [s.enemyKey, { stats: { maxHp: 1, atk: 1, def: 1, res: 1 } }]));
    const opts = defender(wave);
    const lastSpawn = expected.at(-1).time;
    const server = new Battle({ ...opts, data: ds });
    const client = createBattleFromSpec(buildBattleSpec(opts), ds);
    for (const b of [server, client]) {
      const spawned = [];
      b.on('enemySpawn', ({ enemy }) => {
        if (enemy.inTotal) spawned.push({ defId: enemy.defId, hp: enemy.hp, s: { ...enemy.s } });
      });
      b.start();
      while (b.time < lastSpawn + 1 / 30) b.step();
      assert.equal(spawned.length, expected.length);
      spawned.forEach((e, i) => checkStats(e, expected[i].stats));
      assert.equal(b.errorCount, 0);
    }
    // Changing attributes without moving a chess must change the published signature.
    const oldSignature = JSON.stringify(lineup);
    grantInvasionBonus(ps, 'invasion_attack');
    const after = m._monsterLineup();
    assert.notEqual(JSON.stringify(after), oldSignature);
    assert.ok(after.find((p) => p.uid === pieces[1].uid).stats.atk > buffed.atk);
  } finally { h.m.dispose(); }
});

test('legacy waves retain template stats; invalid per-unit fields cannot poison the simulation', () => {
  const key = 'enemy_1422_lrsldr';
  const route = { motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] };
  const opts = defender({ routes: [route], spawns: [{ enemyKey: key, routeIndex: 0 }],
    overrides: { [key]: { stats: { maxHp: 1234, atk: 321 } } } });
  const b = new Battle({ ...opts, data: ds });
  b.start(); b.step();
  assert.equal(b.enemies[0].s.maxHp, 1234);
  assert.equal(b.enemies[0].s.atk, 321);
  const bad = b.spawnEnemy(key, { stats: { maxHp: -1, atk: NaN, def: Infinity, res: null,
    aspd: 0, bat: -1, moveSpeed: -1, motion: 'FLY', abilities: [] } });
  assert.equal(bad.s.maxHp, 1234);
  assert.equal(bad.s.atk, 321);
  assert.equal(bad.motion, 'WALK');
  assert.equal(bad.s.def, ds.getEnemy(key).def);
  assert.equal(b.errorCount, 0);
});

test('each invasion round applies its own health, attack and defense multipliers', () => {
  const h = makeMatch({ mode: 'solo', data: monsterData(version), modeId: 'mode_single_6' });
  try {
    const match = h.m;
    const stats = { maxHp: 1000, atk: 100, def: 50, res: 20, aspd: 110, bat: 2, moveSpeed: 0.75 };
    const lineup = [{ r: 0, c: 0, chessId: 'chess_mon_enemy_10054_cjhot_b', stats }];
    const multipliers = [
      // Round, health, attack, defense.
      [1, 1.8, 1.1, 0.8],
      [2, 1.8, 1.2, 0.8],
      [3, 1.9, 1.2, 0.8],
      [4, 2.2, 1.3, 0.8],
      [5, 2.4, 1.3, 0.85],
      [6, 2.6, 1.3, 0.9],
      [7, 2.6, 1.4, 1],
      [8, 3.2, 1.5, 1.1],
      [9, 3.8, 1.6, 1.25],
      [10, 4.2, 1.7, 1.4],
      [11, 5.6, 1.8, 1.55],
      [12, 6.4, 1.9, 1.7],
      [13, 7.6, 2, 1.9],
      [14, 8.8, 2.1, 2.1],
    ];
    for (const [round, hp, atk, def] of multipliers) {
      match.round = round;
      const payload = match._monsterWavePayload(lineup);
      const expected = { ...stats, maxHp: stats.maxHp * hp, atk: stats.atk * atk, def: stats.def * def };
      assert.deepEqual(payload.spawns[0].stats, expected, `round ${round} invasion payload`);
      const wave = applyOpsWave({ ...defender({ routes: [], spawns: [] }), overrides: {} }, payload, gd);
      assert.deepEqual(wave.spawns[0].stats, expected, `round ${round} defender wave`);
      assert.equal(payload.spawns[0].star, 2);
    }
    assert.equal(stats.maxHp, 1000);
  } finally { h.m.dispose(); }
});

test('the invasion shop gates elite recruits by round and stocks by monster cost', () => {
  const rawInvasion = monsterData(version);
  const h = makeMatch({ mode: 'coop', humans: 4, data: rawInvasion, modeId: 'mode_multi_normal' });
  try {
    const match = h.m;
    const [player] = match.alivePlayers();
    const elite = 'chess_mon_enemy_10054_cjhot';
    const normal = 'chess_mon_enemy_10042_prtrop';
    const cheap = 'chess_mon_enemy_10001_trslim';
    const costly = match.gd.visibleChess.find((id) => match.gd.tierOf(id) === 5);
    assert.deepEqual([cheap, normal, costly].map((id) => match.gd.poolCopies(id)), [18, 14, 8]);
    const testStock = (id) => {
      match.pool.entries.clear();
      match.pool.entries.set(id, { tier: match.gd.tierOf(id), left: 1 });
    };
    player.shop.level = 3;
    match.round = 4;
    testStock(normal);
    assert.equal(player._rollChessSlot(), null);
    player.shop.level = 4;
    assert.equal(player._rollChessSlot()?.id, normal);
    testStock(elite);
    assert.equal(player._rollChessSlot(), null);
    match.round = 5;
    assert.equal(player._rollChessSlot()?.id, elite);
    testStock(costly);
    assert.equal(player._rollChessSlot(), null);
    player.shop.level = 5;
    assert.equal(player._rollChessSlot()?.id, costly);
  } finally { h.m.dispose(); }
});

test('cold tide replaces carrion in new lineups and legacy carrion waves still resolve', () => {
  const h = makeMatch({ mode: 'solo', data: monsterData(version), modeId: 'mode_single_6' });
  try {
    const match = h.m;
    const [player] = match.alivePlayers();
    player.bandId = 'band_qalaisa';
    match.round = 7;
    const lineup = [{ r: 13, c: 7, chessId: 'chess_mon_enemy_1422_lrsldr', sourcePlayerId: player.playerId }];
    const [spawn] = match._monsterWavePayload(lineup).spawns;
    assert.deepEqual(spawn.invasion, { kind: 'coldTide', gate: 'lower' });
    assert.equal(spawn.mods.carrionAtk, undefined);
    const route = { motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] };
    for (const Engine of [Battle, MonsterBattle]) {
      const b = new Engine({ ...defender({ routes: [route], spawns: [] }), data: ds });
      b.start();
      const options = { mods: { ...spawn.mods, carrionAtk: 0.2, carrionStacks: 10 }, sourcePlayerId: spawn.sourcePlayerId };
      const survivor = b.spawnEnemy(spawn.enemyKey, options);
      const victim = b.spawnEnemy(spawn.enemyKey, options);
      const outsider = b.spawnEnemy(spawn.enemyKey, { ...options, sourcePlayerId: 'other-seat' });
      const attack = survivor.s.atk;
      b.kill(victim);
      assert.ok(Math.abs(survivor.s.atk / attack - 1.2) < 1e-9);
      assert.equal(outsider.s.atk, attack);
      const late = b.spawnEnemy(spawn.enemyKey, options);
      assert.equal(late.s.atk, attack);
      for (let index = 0; index < 11; index++) b.kill(b.spawnEnemy(spawn.enemyKey, options));
      assert.ok(Math.abs(survivor.s.atk / attack - 3) < 1e-9);
      assert.equal(b.errorCount, 0);
    }
  } finally { h.m.dispose(); }
});

test('both engine copies keep different snapshots for two scheduled enemies of the same type', () => {
  const stats = { maxHp: 10000.5, atk: 777.25, def: 333.75, res: 27.5,
    aspd: 135, bat: 2.125, moveSpeed: 0.875, hpRecoveryPerSec: 7.5 };
  for (const Engine of [Battle, MonsterBattle]) {
    const opts = defender({ routes: [{ motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] }],
      spawns: [stats, { ...stats, maxHp: 20000.25, atk: 1500.125 }].map((s) => ({
        enemyKey: 'enemy_1422_lrsldr', routeIndex: 0, stats: s,
      })) });
    const b = new Engine({ ...opts, data: ds });
    b.start(); b.step();
    assert.equal(b.enemies.length, 2);
    checkStats(b.enemies[0], stats);
    checkStats(b.enemies[1], opts.spawns[1].stats);
    assert.equal(ds.getEnemy('enemy_1422_lrsldr').atk, 300, 'shared enemy record stays immutable');
    assert.equal(b.errorCount, 0);
  }
});

test('different same-type monster attributes survive leaks, compact results, validation and unite re-entry', () => {
  const stats = { maxHp: 12000.25, atk: 777.75, def: 321.125, res: 22.5,
    aspd: 125, bat: 2.5, moveSpeed: 0.8, hpRecoveryPerSec: 3.25 };
  const payload = { spawns: [stats, { ...stats, maxHp: 24000.5, atk: 999.125 }].map((s) => ({
    enemyKey: 'enemy_1422_lrsldr', stats: s, preview: { gate: 'upper' },
  })) };
  const wave = applyOpsWave(raw.waves.act3autochess_01, payload, gd);
  const opts = { ...defender(wave), players: [{ playerId: 'p', units: [], bonds: {} }] };
  const b = new Battle({ ...opts, data: ds });
  b.start(); b.step();
  // Reverse the leaks so matching merely by enemyKey or list index cannot pass.
  b.addBuff(b.enemies[0], { key: 'temporary-defence-debuff', mods: { atkPct: -0.5, defPct: -0.5 } });
  assert.ok(b.enemies[0].s.atk < stats.atk, 'temporary combat debuffs must not become preparation attributes');
  for (const e of [...b.enemies].reverse()) b.leak(e);
  b.step();
  const result = b.result();
  const wanted = [...payload.spawns].reverse().map((s) => s.stats);
  assert.deepEqual(result.perPlayer.p.leaked.map((l) => l.stats), wanted, 'leak retains the original per-piece attributes');
  const wire = compactResult(result);
  assert.deepEqual(wire.perPlayer.p.leaked.map((l) => l.stats), wanted, 'compact upload keeps the snapshot');
  const altered = structuredClone(wire);
  altered.perPlayer.p.leaked[0].stats.atk++;
  assert.notEqual(resultDigest(wire).hash, resultDigest(altered).hash, 'verification includes per-piece attributes');
  const validation = validateClientResult(buildBattleSpec(opts), wire, { gd });
  assert.ok(validation.ok, validation.reason);
  assert.deepEqual(validation.result.perPlayer.p.leaked.map((l) => l.stats), wanted, 'authority matches the actual piece');
  const forged = structuredClone(wire);
  forged.perPlayer.p.leaked[0].stats.atk = 1;
  const restored = validateClientResult(buildBattleSpec(opts), forged, { gd });
  assert.equal(restored.ok, false, 'invented attributes require authoritative re-simulation');
  assert.equal(restored.reason, 'leak stats');
  const duplicated = structuredClone(wire);
  duplicated.perPlayer.p.leaked[1].stats = { ...duplicated.perPlayer.p.leaked[0].stats };
  assert.equal(validateClientResult(buildBattleSpec(opts), duplicated, { gd }).ok, false, 'one strong piece cannot be reported twice');
  const player = (id, seat) => ({ playerId: id, seat, board: new Map(), deployCount: 0, bonds: {}, bounties: [] });
  const leaker = player('p', 0), helper = player('helper', 1);
  const plan = planUnite({ isSolo: false, gd, alivePlayers: () => [leaker, helper] },
    new Map([['p', validation.result.perPlayer.p], ['helper', { perfect: true, leaked: [] }]]));
  assert.ok(plan);
  assert.deepEqual(plan.leaked.map((l) => l.stats), wanted);
  const unite = buildUniteWave(gd, plan.leaked, 1, 60);
  const reentry = new Battle({ ...defender(unite), kind: 'unite', data: ds, content: 'none' });
  reentry.start(); reentry.step();
  assert.equal(reentry.enemies.length, 2);
  reentry.enemies.forEach((e, i) => checkStats(e, wanted[i]));
  assert.equal(reentry.errorCount, 0);
});

test('equal attributes do not merge distinct scheduled multipliers on result validation', () => {
  const stats = { maxHp: 12000, atk: 777, def: 321, res: 22, aspd: 125, bat: 2.5, moveSpeed: 0.8, hpRecoveryPerSec: 0 };
  const wave = applyOpsWave(raw.waves.act3autochess_01, { spawns: [1, 2].map((n) => ({
    enemyKey: 'enemy_1422_lrsldr', stats, mods: { hpMul: n, atkMul: n }, preview: { gate: 'upper' },
  })) }, gd);
  const opts = { ...defender(wave), players: [{ playerId: 'p', units: [], bonds: {} }] };
  const b = new Battle({ ...opts, data: ds });
  b.start(); b.step();
  for (const e of [...b.enemies].reverse()) b.leak(e);
  b.step();
  const wire = compactResult(b.result());
  const v = validateClientResult(buildBattleSpec(opts), wire, { gd });
  assert.ok(v.ok, v.reason);
  assert.deepEqual(v.result.perPlayer.p.leaked.map((l) => l.mods), wire.perPlayer.p.leaked.map((l) => l.mods));
});
