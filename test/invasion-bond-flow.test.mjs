import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData as invasionData } from '../game/server/data.js';
import { GameData as InvasionData } from '../game/server/match/gamedata.js';
import { MatchCombat } from '../game/server/match/match/combat.js';
import { getVersionData as allianceData } from '../game_ops/server/data.js';
import { GameData as AllianceData } from '../game_ops/server/match/gamedata.js';
import { MatchUnite } from '../game_ops/server/match/match/unitePhase.js';
import { planUnite } from '../game_ops/server/match/unite.js';
import { applyOpsWave } from '../game_ops/server/match/waves.js';
import { buildBattleSpec, createBattleFromSpec } from '../game_ops/server/sim/spec.js';
import { invasionReportOf } from '../bridge/invasion-report.js';

const version = 'act3autochess@V3_1';
const modeId = 'mode_multi_normal';
const invasion = new InvasionData(invasionData(version), modeId);
const alliance = new AllianceData(allianceData(version), modeId);
const drone = 'mon_main_drone';
const seaborn = 'mon_main_seaborn';

function makeWave() {
  const aircraft = invasion.visibleChess.filter(id => invasion.chess(id).bonds.includes(drone));
  assert.ok(aircraft.length >= 4);
  const match = Object.assign(Object.create(MatchCombat.prototype), {
    gd: invasion, players: new Map(), round: 5, disabledBonds: [],
  });
  const playerA = [...aircraft.slice(0, 4), invasion.chess(aircraft[0]).goldenId].map((chessId, i) =>
    ({ r: 16, c: 7 + i, chessId, sourcePlayerId: 'attacker-a' }));
  const playerB = { r: 16, c: 7, chessId: aircraft[0], sourcePlayerId: 'attacker-b' };
  return applyOpsWave({ routes: [] }, JSON.parse(JSON.stringify(match._monsterWavePayload([...playerA, playerB]))), alliance);
}

test('the generated covenant data uses the reachable orchestra tier and describes both revised abilities', () => {
  assert.deepEqual(invasion.bond('mon_main_witchking').thresholds, [4, 6]);
  assert.match(invasion.bond('mon_main_yan').desc, /6 个.*30%/);
  assert.match(invasion.bond('mon_main_yan').desc, /10 个.*45%/);
  assert.match(invasion.bond('mon_sub_invisible').desc, /100%/);
  assert.match(invasion.bond('mon_sub_invisible').desc, /150%/);
  assert.deepEqual(invasion.bond(seaborn).thresholds, [4, 7]);
  assert.match(invasion.bond(seaborn).desc, /【4 种】.*10%.*神经.*20%/);
  assert.match(invasion.bond(seaborn).desc, /【7 种】.*分裂.*50%/);
});

test('the invasion report has all three bond groups with battle data and the recruitable base monsters', () => {
  const report = invasionReportOf(invasionData(version));
  assert.deepEqual(report.map(bond => bond.bondId), invasion.bondIds);
  assert.deepEqual(Object.fromEntries(['main', 'minor', 'sub'].map(kind =>
    [kind, report.filter(bond => bond.kind === kind).length])), { main: 11, minor: 12, sub: 9 });
  for (const bond of report) {
    const record = invasion.bond(bond.bondId);
    assert.equal(bond.desc, record.desc);
    assert.deepEqual(bond.thresholds, record.thresholds);
    const expected = invasion.visibleChess.filter(id => invasion.chess(id).bonds.includes(bond.bondId));
    assert.deepEqual(bond.monsters.map(monster => monster.chessId), expected);
  }
});

test('the opponent receives separate activation tiers for each invading seat', () => {
  const { spawns } = makeWave();
  const active = spawns.filter(spawn => spawn.sourcePlayerId === 'attacker-a');
  assert.ok(active.length >= 4);
  for (const spawn of active) {
    assert.equal(spawn.invasionBonds?.tiers?.[drone], 1);
    assert.equal(spawn.invasionBonds?.seat, 'attacker-a');
  }
  const [inactive] = spawns.filter(spawn => spawn.sourcePlayerId === 'attacker-b');
  assert.equal(inactive.invasionBonds?.tiers?.[drone], undefined);
  assert.ok(inactive.invasionBonds?.members?.includes(drone));
});

test('an invader keeps its tier and original seat but cannot refresh the first-drone quota in joint combat', () => {
  const { spawns, routes } = makeWave();
  const wave = spawns.filter(spawn => spawn.sourcePlayerId === 'attacker-a').slice(0, 2)
    .map(spawn => ({ ...spawn, count: 1, time: 0 }));
  const defender = { playerId: 'defender', seat: 0, board: new Map(), bounties: [], bonds: {} };
  const input = playerId => ({ playerId, units: [], bonds: {} });
  const helper = { ...defender, playerId: 'helper', seat: 1, battleInput: () => input('helper') };
  const opts = { seed: 1, kind: 'normal', fieldId: 'lane', stageId: 'act3autochess_m04', modeId, round: 5,
    timeLimit: 60, flags: { duelGateLeaks: true }, players: [input('defender')], spawns: wave, routes };
  const lane = createBattleFromSpec(buildBattleSpec(opts), allianceData(version));
  lane.step();
  const [first, second] = lane.enemies;
  const shield = enemy => enemy.buffs.find(buff => buff.shield > 0)?.shield ?? 0;
  assert.equal(shield(first), first.s.maxHp * 0.2);
  assert.equal(shield(second), 0);
  lane.kill(first);
  lane.leak(second);
  lane.step();
  const lastResults = new Map([['defender', lane.result().perPlayer.defender], ['helper', { perfect: true, leaked: [] }]]);
  const match = { gd: alliance, opts: { duel: true }, seed: 1, round: 5, modeId, lastResults, stageId: opts.stageId,
    alivePlayers: () => [defender, helper], dispatch() {}, _sanitizeSpawns: spawns => spawns };
  const plan = planUnite(match, lastResults);
  const jointOpts = MatchUnite.prototype._uniteOpts.call(match, plan, 60);
  const joint = createBattleFromSpec(buildBattleSpec(jointOpts), allianceData(version));
  while (!joint.finished && joint.enemies.length === 0) joint.step();
  const [survivor] = joint.enemies;
  assert.equal(survivor.sourcePlayerId, 'defender');
  assert.equal(survivor.invasionBonds?.seat, 'attacker-a');
  assert.equal(survivor.invasionBonds?.tiers?.[drone], 1);
  assert.equal(shield(survivor), 0);
  assert.equal(lane.errorCount + joint.errorCount, 0);
});

test('海嗣 deaths produce one routed offspring, including flyers, and a survivor never splits again in joint combat', () => {
  const members = invasion.visibleChess.filter(id => invasion.chess(id).bonds.includes(seaborn));
  const ids = ['chess_mon_enemy_1433_dsbasi', 'chess_mon_enemy_1435_dsflys'];
  for (const id of ids) assert.ok(members.includes(id), id);
  const formation = [...ids, ...members.filter(id => !ids.includes(id)).slice(0, 5)];
  const match = Object.assign(Object.create(MatchCombat.prototype), {
    gd: invasion, players: new Map(), round: 5, disabledBonds: [],
  });
  const entries = formation.map((chessId, i) => ({ r: 16, c: 7 + i, chessId, sourcePlayerId: 'attacker-a' }));
  const payload = match._monsterWavePayload(entries);
  const { spawns, routes } = applyOpsWave({ routes: [] }, JSON.parse(JSON.stringify(payload)), alliance);
  const wave = spawns.filter(spawn => ['enemy_1433_dsbasi', 'enemy_1435_dsflys'].includes(spawn.enemyKey))
    .map(spawn => ({ ...spawn, count: 1, time: 0 }));
  const input = playerId => ({ playerId, units: [], bonds: {} });
  const opts = { seed: 1, kind: 'normal', fieldId: 'lane', stageId: 'act3autochess_m04', modeId, round: 5,
    timeLimit: 60, flags: { duelGateLeaks: true }, players: [input('defender')], spawns: wave, routes };
  const lane = createBattleFromSpec(buildBattleSpec(opts), allianceData(version));
  lane.step();

  const parents = [...lane.enemies];
  assert.equal(parents.length, 2);
  const children = parents.map(parent => {
    assert.equal(parent.invasionBonds.tiers[seaborn], 2);
    const total = lane.enemies.length;
    lane.kill(parent);
    assert.equal(lane.enemies.length, total + 1);
    const child = lane.enemies.at(-1);
    assert.equal(child.invasionBonds.offspring, true);
    assert.equal(child.invasionBonds.tiers[seaborn], 2);
    assert.equal(child.sourcePlayerId, parent.sourcePlayerId);
    assert.equal(child.ownerId, parent.ownerId);
    assert.equal(child.motion, parent.motion);
    assert.deepEqual(child.route.legs.at(-1), parent.route.legs.at(-1));
    assert.equal(child.counted, true);
    assert.equal(child.inTotal, false);
    return child;
  });
  const total = lane.enemies.length;
  lane.kill(children.find(child => child.motion === 'WALK'));
  lane.leak(children.find(child => child.motion === 'FLY'));
  assert.equal(lane.enemies.length, total);
  assert.equal(lane.gateLeaks, 1);
  lane.step();

  const defender = { playerId: 'defender', seat: 0, board: new Map(), bounties: [], bonds: {} };
  const helper = { ...defender, playerId: 'helper', seat: 1, battleInput: () => input('helper') };
  const lastResults = new Map([['defender', lane.result().perPlayer.defender], ['helper', { perfect: true, leaked: [] }]]);
  const jointMatch = { gd: alliance, opts: { duel: true }, seed: 1, round: 5, modeId, lastResults, stageId: opts.stageId,
    alivePlayers: () => [defender, helper], dispatch() {}, _sanitizeSpawns: out => out };
  const plan = planUnite(jointMatch, lastResults);
  const jointOpts = MatchUnite.prototype._uniteOpts.call(jointMatch, plan, 60);
  const joint = createBattleFromSpec(buildBattleSpec(jointOpts), allianceData(version));
  while (!joint.finished && joint.enemies.length === 0) joint.step();
  const [survivor] = joint.enemies;
  assert.equal(survivor.invasionBonds.seat, 'attacker-a');
  assert.equal(survivor.invasionBonds.tiers[seaborn], 2);
  assert.equal(survivor.invasionBonds.offspring, true);
  joint.kill(survivor);
  assert.equal(joint.aliveEnemies().length, 0);
  assert.equal(lane.errorCount + joint.errorCount, 0);
});
