import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData as monsterData } from '../game/server/data.js';
import { GameData as MonsterData } from '../game/server/match/gamedata.js';
import { bannedChessForBonds } from '../game/server/match/pool.js';
import { createRng } from '../game/server/sim/rng.js';
import { MatchCombat } from '../game/server/match/match/combat.js';
import { waveFromLineup } from '../game/server/match/monsterWave.js';
import { getVersionData as defenderData } from '../game_ops/server/data.js';
import { GameData } from '../game_ops/server/match/gamedata.js';
import { applyOpsWave, buildUniteWave, previewOf } from '../game_ops/server/match/waves.js';
import { planUnite, uniteBattleOpts } from '../game_ops/server/match/unite.js';
import { validateClientResult } from '../game_ops/server/match/fields.js';
import { DataSource } from '../game_ops/server/sim/simdata.js';
import { Battle } from '../game_ops/server/sim/Battle.js';
import { buildBattleSpec, compactResult } from '../game_ops/server/sim/spec.js';
import { duelRound } from '../bridge/duel.js';

const version = 'act3autochess@V3_1';
const slug = 'mon_main_slug';
const ids = ['1007_slime', '1021_bslime', '1067_snslime', '1305_mhslim', '1424_lrboom', '10001_trslim',
  '1132_sarchn', '1133_harchn'].map((id) => `chess_mon_enemy_${id}`);
const monster = new MonsterData(monsterData(version), 'mode_multi_normal');
const raw = defenderData(version);
const defender = new GameData(raw, 'mode_multi_normal');
const base = raw.waves.act3autochess_01;
const data = new DataSource(raw);

function lineup(cards, sourcePlayerId = 'invasion-a', row = 16) {
  return cards.map((chessId, index) => ({ chessId, sourcePlayerId, r: row - Math.floor(index / 5), c: 8 + index % 5 }));
}

function payload(pieces, disabledBonds = []) {
  const match = Object.assign(Object.create(MatchCombat.prototype), {
    gd: monster, round: 5, disabledBonds, players: new Map(),
  });
  return match._monsterWavePayload(pieces);
}

test('all eight Originium Slug species are shop members in every installed version', () => {
  for (const installed of [undefined, 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1', version]) {
    const gd = new MonsterData(monsterData(installed), 'mode_multi_normal');
    assert.deepEqual(gd.visibleChess.filter((id) => gd.chess(id).bonds.includes(slug)).sort(), [...ids].sort());
    assert.match(gd.bond(slug).desc, /在场 7 种不同的【源石虫】时，每个【源石虫】单位增加 6 只怪物/);
    for (const spider of ids.slice(-2)) {
      for (const suffix of ['', '_b']) {
        for (const bond of [slug, 'mon_main_infection', 'mon_sub_reborn']) {
          assert.ok(gd.chess(spider + suffix).bonds.includes(bond), `${installed} ${spider + suffix}: ${bond}`);
        }
      }
    }
  }
});

test('the per-core cap cannot make the enabled seven-species tier unobtainable', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const banned = new Set(bannedChessForBonds(monster, [], [], createRng(seed)));
    assert.ok(ids.every((id) => !banned.has(id)), `seed ${seed}`);
  }
});

test('unit size is per rank and highest enabled tier, counting distinct deployed species per player', () => {
  const nonmember = 'chess_mon_enemy_1422_lrsldr';
  const golden = `${ids[0]}_b`;
  const copies = (spawns) => spawns.find((s) => s.enemyKey === 'enemy_1007_slime')?.count;
  assert.deepEqual(payload(lineup([nonmember, `${nonmember}_b`])).spawns.map((s) => s.count), [2, 3]);
  const duplicates = payload(lineup([...ids.slice(0, 3), golden]));
  assert.deepEqual(duplicates.spawns.filter((s) => s.star === 2).map((s) => s.count), [3]);
  assert.equal(copies(payload(lineup(ids.slice(0, 4))).spawns), 5);
  assert.equal(payload(lineup([golden, ...ids.slice(1, 4)])).spawns.find((s) => s.star === 2).count, 6);
  const upper = [...lineup([golden, ...ids.slice(1, 7)]), ...lineup([ids[0], nonmember], 'invasion-b', 13)];
  const counts = payload(upper).spawns;
  assert.deepEqual(counts.filter((s) => s.sourcePlayerId === 'invasion-a').map((s) => s.count).sort((a, b) => a - b), [8, 8, 8, 8, 8, 8, 9]);
  assert.deepEqual(counts.filter((s) => s.sourcePlayerId === 'invasion-b').map((s) => s.count), [2, 2]);
  assert.equal(copies(payload(lineup(ids.slice(0, 4)), [slug]).spawns), 2);
  assert.equal(copies(payload([...lineup(ids.slice(0, 3)), ...lineup([ids[3]], 'invasion-b', 13)]).spawns), 2);
  assert.equal(waveFromLineup(base, lineup([nonmember])).spawns[0].count, 2);
  assert.equal(waveFromLineup(base, lineup(ids.slice(0, 7)), monster).spawns[0].count, 8);
});

test('the receiving red gates spawn each creature and 联防 only repeats the one that leaked', () => {
  const pieces = [...lineup([ids[0]]), ...lineup([`${ids[1]}_b`], 'invasion-b', 13)];
  const wave = applyOpsWave(base, JSON.parse(JSON.stringify(payload(pieces))), defender);
  const preview = previewOf(wave.spawns);
  assert.deepEqual(new Map(preview.map((s) => [s.gate, s.count])), new Map([['lower', 3], ['upper', 2]]));
  const options = { seed: 1, kind: 'normal', stageId: 'act3autochess_m05', round: 5, modeId: 'mode_multi_normal',
    timeLimit: 90, players: [{ playerId: 'defender', units: [], bonds: {} }], content: 'none',
    routes: wave.routes, spawns: wave.spawns.map((s) => ({ ...s, time: 0 })) };
  const battle = new Battle({ ...options, data });
  battle.start();
  while (battle.time < 4 && !battle.finished) battle.step();
  assert.equal(battle.enemies.filter((e) => e.spawnY === 12).length, 2);
  assert.equal(battle.enemies.filter((e) => e.spawnY === 9).length, 3);
  const [leaker, ...stopped] = battle.enemies;
  battle.leak(leaker);
  for (const enemy of stopped) battle.kill(enemy);
  battle.step();
  const checked = validateClientResult(buildBattleSpec(options), compactResult(battle.result()), { gd: defender });
  assert.ok(checked.ok, checked.reason);
  const result = checked.result.perPlayer.defender;
  assert.equal(result.leaked.length, 1);
  const player = (playerId, seat) => ({ playerId, seat, lp: 26, board: new Map(), deployCount: 0, bonds: {}, bounties: [] });
  const players = [player('defender', 0), player('helper', 1)];
  const plan = planUnite({ isSolo: false, gd: defender, alivePlayers: () => players },
    new Map([['defender', result], ['helper', { perfect: true, leaked: [] }]]));
  const unite = buildUniteWave(defender, plan.leaked, 5, 60);
  assert.deepEqual(unite.spawns.map((s) => s.count), [1]);
  assert.equal(duelRound(players, { defender: result.leaked.length }, 5).pool.ops, 51);
});

test('4v4 unite waves fit every scheduled enemy into 25 seconds', () => {
  const helpers = ['helper-a', 'helper-b'].map((playerId) => ({
    playerId, board: new Map(), battleInput: () => ({ playerId, units: [], bonds: {} }),
  }));
  const match = { gd: defender, opts: { duel: true }, round: 5, lastResults: new Map(), dispatch() {} };
  const leaked = Array.from({ length: 80 }, (_, i) => ({
    enemyKey: i % 3 === 0 ? 'enemy_1005_yokai' : 'enemy_1007_slime',
    sourcePlayerId: i % 2 === 0 ? 'invasion-a' : 'invasion-b',
    mods: { hpMul: 1.25 }, bounty: { coins: 1 },
  }));
  const build = (list, limit = 60) => uniteBattleOpts(match, { helpers, leaked: list }, limit);
  const original = buildUniteWave(defender, leaked, helpers.length, 60);
  assert.ok(original.spawns.at(-1).time > 25);
  const { wave, players } = build(leaked);
  assert.equal(wave.spawns.length, leaked.length);
  assert.equal(wave.spawns[0].time, original.spawns[0].time);
  assert.ok(wave.spawns.at(-1).time <= 25);
  const withoutTime = (spawns) => spawns.map(({ time, ...spawn }) => spawn);
  assert.deepEqual(withoutTime(wave.spawns), withoutTime(original.spawns));
  assert.deepEqual(build(leaked.slice(0, 2)).wave, buildUniteWave(defender, leaked.slice(0, 2), helpers.length, 60));
  assert.ok(build(leaked, 18).wave.spawns.at(-1).time < 18);

  const battle = new Battle({
    seed: 1, kind: 'unite', modeId: 'mode_multi_normal', stageId: 'act3autochess_m05',
    timeLimit: 60, content: 'none', data, players, routes: wave.routes, spawns: wave.spawns,
  });
  const spawns = [];
  battle.on('enemySpawn', ({ enemy }) => spawns.push([battle.time, enemy.defId]));
  while (!battle.finished && battle.time < 25) battle.step();
  assert.equal(spawns.length, leaked.length);
  assert.ok(spawns.at(-1)[0] <= 25);
});

test('tier six begins with one creature and upgrades to two across both invasion wave paths', () => {
  const bear = 'chess_mon_enemy_2002_bearmi';
  const pieces = lineup([bear, bear + '_b', ids[0], ids[0] + '_b']);
  assert.equal(monster.tierOf(bear), 6);
  const expected = [1, 2, 2, 3];
  assert.deepEqual(payload(pieces).spawns.map((s) => s.count), expected);
  assert.deepEqual(waveFromLineup(base, pieces, monster).spawns.map((s) => s.count), expected);
  const wave = applyOpsWave(base, JSON.parse(JSON.stringify(payload(pieces))), defender);
  assert.deepEqual(previewOf(wave.spawns).map((s) => s.count), expected);
  assert.equal(payload([{ ...pieces[1], extraMembers: 1 }]).spawns[0].count, 3);

  const battle = new Battle({ seed: 1, kind: 'normal', stageId: 'act3autochess_m05',
    round: 5, modeId: 'mode_multi_normal', timeLimit: 90, players: [], data, routes: wave.routes,
    spawns: wave.spawns.map((spawn) => ({ ...spawn, time: 0 })) });
  while (battle.time < 4 && !battle.finished) battle.step();
  const gopnik = (id) => battle.enemies.filter((e) => e.defId === id).map((e) => [e.s.maxHp, e.s.atk]);
  assert.deepEqual(gopnik('enemy_2002_bearmi'), [[26400, 2080]]);
  assert.deepEqual(gopnik('enemy_2002_bearmi_2'), [[72000, 2600], [72000, 2600]]);
});
