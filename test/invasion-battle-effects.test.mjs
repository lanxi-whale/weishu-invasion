import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Battle as InvasionBattle } from '../game/server/sim/Battle.js';
import { Battle } from '../game_ops/server/sim/Battle.js';
import { getVersionData } from '../game_ops/server/data.js';
import { DataSource } from '../game_ops/server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../game_ops/server/sim/spec.js';
import { chessRec, enemyRec, flatStage } from '../game/test/helpers/battleHarness.js';

const version = 'act3autochess@V3_1';
const data = new DataSource(getVersionData(version));
const fieldTile = [12, 10];
const stationary = { motion: 'WALK', start: fieldTile, end: fieldTile, steps: [{ t: 'wait', s: 60 }] };
const sourcePlayerId = 'invasion-a';
const deathParent = 'enemy_1131_sbeast';
const deathChild = 'enemy_1137_plasm';
const skillParent = 'enemy_10077_mpbarr';
const skillChild = 'enemy_10073_mpcar';
const cocoon = { kind: 'cocoon', gate: 'upper' };

function spawn(enemyKey, count, { source = sourcePlayerId, invasion = cocoon, pos = fieldTile } = {}) {
  return { enemyKey, count, time: 0, pos, route: stationary, invasion, sourcePlayerId: source };
}

function battleOptions(spawns, kind = 'normal') {
  return {
    seed: 1, kind, stageId: 'act3autochess_m04', modeId: 'mode_single_6', round: 1, timeLimit: 30,
    players: [], content: 'full', spawns, routes: [],
  };
}

function battles(options, source = data) {
  const spec = buildBattleSpec(options);
  return [new Battle({ ...options, data: source }), createBattleFromSpec(spec, source, { BattleClass: InvasionBattle })];
}

function advance(battle, seconds) {
  const end = battle.time + seconds;
  while (!battle.finished && battle.time < end - 1e-9) battle.step();
  assert.equal(battle.errorCount, 0);
}

function units(battle, key, source = sourcePlayerId) {
  return battle.enemies.filter((u) => u.alive && u.defId === key && u.sourcePlayerId === source);
}

test('cocoon protects only the first six offspring, sharing the quota across skill summons and death splits', () => {
  const options = battleOptions([
    spawn(skillParent, 1),
    spawn(deathParent, 4),
    spawn(deathParent, 1, { source: 'invasion-b', invasion: null }),
    spawn(deathParent, 1, { source: 'invasion-c' }),
  ]);
  for (const battle of battles(options)) {
    advance(battle, 3.1);
    const [summon] = units(battle, skillChild);
    assert.equal(units(battle, skillChild).length, 1);
    assert.equal(summon.s.shield, 1000);
    assert.ok(Math.abs(summon.s.moveSpeed - 2.85) < 1e-9);
    assert.equal(units(battle, skillParent)[0].s.shield, 0);

    for (const parent of [sourcePlayerId, 'invasion-b', 'invasion-c'].flatMap((source) => units(battle, deathParent, source))) {
      battle.kill(parent);
    }
    advance(battle, 1.1);
    const children = units(battle, deathChild);
    assert.equal(children.length, 8);
    assert.deepEqual(children.map((child) => child.s.shield), [500, 500, 500, 500, 500, 0, 0, 0]);
    assert.deepEqual(units(battle, deathChild, 'invasion-b').map((child) => child.s.shield), [0, 0]);
    assert.deepEqual(units(battle, deathChild, 'invasion-c').map((child) => child.s.shield), [500, 500]);
  }
});

test('cocoon absorbs harm and holds the speed bonus through expiration even after the shield breaks', () => {
  const options = battleOptions([spawn(deathParent, 1)]);
  for (const battle of battles(options)) {
    battle.step();
    battle.kill(units(battle, deathParent)[0]);
    advance(battle, 1.1);
    const [hit, untouched] = units(battle, deathChild);
    const hp = hit.hp;
    assert.equal(hit.s.shield, 500);
    battle.dealDamage({ source: null, target: hit, amount: 600, type: 'true' });
    assert.equal(hit.hp, hp - 100);
    assert.equal(hit.s.shield, 0);
    assert.ok(Math.abs(hit.s.moveSpeed - 2.85) < 1e-9);
    advance(battle, untouched.deployedAt + 11.8 - battle.time);
    assert.equal(untouched.s.shield, 500);
    assert.ok(Math.abs(hit.s.moveSpeed - 2.85) < 1e-9);
    advance(battle, 0.4);
    assert.equal(untouched.s.shield, 0);
    assert.equal(hit.s.moveSpeed, 1.9);
  }
});

test('cocoon does not protect offspring in joint combat', () => {
  for (const battle of battles(battleOptions([spawn(deathParent, 1)], 'unite'))) {
    battle.step();
    battle.kill(units(battle, deathParent)[0]);
    advance(battle, 1.1);
    const children = units(battle, deathChild);
    assert.equal(children.length, 2);
    assert.ok(children.every((child) => child.s.shield === 0 && child.s.moveSpeed === 1.9));
  }
});

const testStage = flatStage({ id: 'invasion-strategy-test' });
const guard = chessRec({ id: 'test_guard', stats: { atk: 0, maxHp: 10000, blockCnt: 8 }, skill: null });
const sniper = chessRec({ id: 'test_sniper', profession: 'SNIPER', stats: { atk: 0, maxHp: 10000 }, skill: null });
const idle = enemyRec({ key: 'enemy_test_invasion_idle', hp: 1000, dmgType: 'none' });
const walker = enemyRec({ key: 'enemy_test_invasion_melee', hp: 1000, atk: 500 });
const shooter = enemyRec({ key: 'enemy_test_invasion_ranged', hp: 1000, atk: 500, range: 3, bat: 1 });
const testData = new DataSource({
  stages: { [testStage.id]: testStage }, chess: { [guard.chessId]: guard, [sniper.chessId]: sniper },
  enemies: Object.fromEntries([idle, walker, shooter].map(rec => [rec.key, rec])),
}, data);

function mark(kind, { key = idle.key, pos = [10, 8], time = 0, count = 1, gate = 'upper', source = sourcePlayerId } = {}) {
  return { enemyKey: key, time, pos, count, route: { ...stationary, start: pos, end: pos },
    sourcePlayerId: source, invasion: kind ? { kind, gate } : null };
}

function simulations(spawns, operators = [], kind = 'normal') {
  const options = {
    ...battleOptions(spawns, kind), stageId: testStage.id, rect: { r0: 9, r1: 12, c0: 2, c1: 10 },
    players: [{ playerId: 'defender', coords: 'field', units: operators.map(([row, col, rec = guard]) => ({ chessId: rec.chessId, row, col })) }],
  };
  return battles(options, testData);
}

test('heavy cover shields 20% of final health for eight seconds and double gate boosts speed for six', () => {
  for (const battle of simulations([mark('heavyCover'), mark('doubleGate'), mark(null)])) {
    battle.step();
    const [covered, hurried, ordinary] = battle.enemies;
    assert.equal(covered.s.shield, 200);
    assert.equal(hurried.s.moveSpeed, 1.2);
    assert.equal(ordinary.s.shield, 0);
    assert.equal(ordinary.s.moveSpeed, 1);
    advance(battle, 6.1);
    assert.equal(hurried.s.moveSpeed, 1);
    assert.equal(covered.s.shield, 200);
    advance(battle, 2);
    assert.equal(covered.s.shield, 0);
  }
});

test('ram stuns its first blocker and slipstream escapes only its first block', () => {
  for (const battle of simulations([mark('ram', { pos: [11, 8] }), mark('slipstream', { pos: [11, 9] })], [[11, 8], [11, 9]])) {
    battle.step();
    const firstBlocker = battle.unitAt(11, 8);
    const [ram, slip] = battle.enemies;
    assert.equal(firstBlocker.s.flags.stun, true);
    assert.equal(ram.blockedBy, null);
    assert.equal(slip.s.flags.unblockable, true);
    assert.equal(slip.blockedBy, null);
    advance(battle, 1.3);
    assert.equal(firstBlocker.s.flags.stun, false);
    assert.equal(ram.blockedBy, firstBlocker);
    assert.equal(slip.blockedBy, null);
    advance(battle, 0.9);
    assert.equal(slip.blockedBy, battle.unitAt(11, 9));
  }
});

test('shadow raid loses concealment immediately after blocking or after five seconds', () => {
  for (const battle of simulations([mark('shadowRaid', { pos: [11, 8] }), mark('shadowRaid', { pos: [11, 4] })], [[11, 8]])) {
    battle.step();
    const [blocked, free] = battle.enemies;
    assert.ok(blocked.blockedBy);
    assert.equal(blocked.s.flags.stealth, undefined);
    assert.equal(free.s.flags.stealth, true);
    battle.kill(blocked.blockedBy);
    advance(battle, 4.8);
    assert.equal(blocked.s.flags.stealth, undefined);
    assert.equal(free.s.flags.stealth, true);
    advance(battle, 0.3);
    assert.equal(free.s.flags.stealth, undefined);
  }
});

test('cold tide fires once on the first gate to reach three distinct blocked creatures', () => {
  for (const battle of simulations([
    mark('coldTide', { pos: [10, 5], count: 2 }),
    mark('coldTide', { pos: [11, 8], count: 2, gate: 'lower' }),
    mark('coldTide', { pos: [11, 8], time: 1, gate: 'lower' }),
    mark('coldTide', { pos: [10, 5], time: 2 }),
  ], [[10, 5], [11, 8], [11, 7], [12, 7]])) {
    battle.step();
    const upper = battle.unitAt(10, 5);
    const lower = battle.unitAt(11, 8);
    const adjacent = battle.unitAt(11, 7);
    const diagonal = battle.unitAt(12, 7);
    assert.equal(lower.s.aspd, 100);
    battle.releaseBlocked(lower);
    advance(battle, 0.2);
    assert.equal(lower.s.aspd, 100);
    advance(battle, 1);
    assert.equal(lower.s.aspd, 80);
    assert.equal(adjacent.s.aspd, 80);
    assert.equal(diagonal.s.aspd, 100);
    advance(battle, 5);
    assert.equal(upper.s.aspd, 100);
    assert.equal(lower.s.aspd, 100);
  }
});

test('armor piercing applies on each marked monster’s first hit and the same operator can only be affected once', () => {
  for (const battle of simulations([mark('armorPiercing', { count: 3 })], [[11, 5], [11, 6]])) {
    battle.step();
    const [first, second, third] = battle.enemies;
    const victim = battle.unitAt(11, 5);
    const other = battle.unitAt(11, 6);
    const hit = (source, target) => battle.dealDamage({ source, target, amount: 10, type: 'true', isAttack: true });
    battle.applyStatus(victim, 'invulnerable', { duration: 0.1 });
    hit(first, victim);
    assert.equal(victim.s.def, 200);
    advance(battle, 0.2);
    hit(first, victim);
    assert.equal(victim.s.def, 170);
    hit(first, other);
    assert.equal(other.s.def, 200);
    advance(battle, 5.1);
    hit(second, victim);
    assert.equal(victim.s.def, 200);
    hit(second, other);
    assert.equal(other.s.def, 200);
    hit(third, other);
    assert.equal(other.s.def, 170);
  }
});

test('salt erosion reduces healing by 35% and a second first hit refreshes its duration', () => {
  for (const battle of simulations([mark('saltErosion', { count: 2 })], [[11, 5]])) {
    battle.step();
    const target = battle.unitAt(11, 5);
    const [first, second] = battle.enemies;
    const hit = source => battle.dealDamage({ source, target, amount: 500, type: 'true', isAttack: true });
    const heal = () => battle.heal({ target, amount: 100 });
    hit(first);
    assert.equal(heal(), 65);
    advance(battle, 4);
    hit(first);
    hit(second);
    advance(battle, 2.2);
    assert.equal(heal(), 65);
    advance(battle, 4);
    assert.equal(heal(), 100);
  }
});

test('high-ground suppression prioritizes and boosts only the first two normal attacks', () => {
  for (const battle of simulations([mark('highGround', { key: shooter.key, pos: [10, 4] })], [[10, 2, sniper], [10, 4]])) {
    const hits = [];
    battle.on('damageApplied', ({ source, target, amount }) => {
      if (source?.defId === shooter.key) hits.push([target.tileC, amount]);
    });
    advance(battle, 3.5);
    assert.deepEqual(hits.slice(0, 3), [[2, 360], [2, 360], [4, 300]]);
  }
});

test('high-ground suppression boosts every stone in two catapult volleys and the first artillery shell', () => {
  for (const battle of simulations([mark('highGround', { key: 'enemy_10162_mnctpt', pos: [10, 4] })], [[10, 2, sniper], [10, 4]])) {
    const hits = [];
    battle.on('damageApplied', ({ source, target, amount }) => {
      if (source?.defId === 'enemy_10162_mnctpt') hits.push([target.tileC, amount]);
    });
    advance(battle, 18);
    assert.deepEqual(hits.slice(0, 7), [...Array.from({ length: 6 }, () => [2, 660]), [4, 550]]);
  }
  for (const battle of simulations([mark('highGround', { key: 'enemy_1112_emppnt', pos: [10, 4] })], [[10, 2, sniper], [10, 4]])) {
    advance(battle, 3.5);
    assert.equal(battle.unitAt(10, 2).hp, 9040);
    assert.equal(battle.unitAt(10, 4).hp, 10000);
  }
});

test('an armor-piercing shell applies the first-hit debuff while its damage stays source-less', () => {
  for (const battle of simulations([mark('armorPiercing', { key: 'enemy_1112_emppnt', pos: [10, 4] })], [[10, 2, sniper]])) {
    const sources = [];
    battle.on('damageApplied', c => sources.push(c.source));
    advance(battle, 3.5);
    assert.deepEqual(sources, [null]);
    assert.equal(battle.unitAt(10, 2).s.def, 170);
  }
});

test('vine relay creates two owner-only, non-stacking attack zones at blocked deaths', () => {
  for (const battle of simulations([
    mark('vineRelay', { count: 3, pos: [11, 8] }),
    mark(null, { key: walker.key, pos: [11, 8] }),
    mark(null, { key: walker.key, pos: [11, 8], source: 'invasion-b' }),
  ], [[11, 8]])) {
    battle.step();
    const [first, second, third, own, other] = battle.enemies;
    assert.ok(first.blockedBy && second.blockedBy && third.blockedBy);
    battle.kill(first);
    advance(battle, 2);
    battle.kill(second);
    assert.equal(own.s.atk, 600);
    assert.equal(other.s.atk, 500);
    advance(battle, 2);
    battle.kill(third);
    advance(battle, 3.2);
    assert.equal(own.s.atk, 500);
    assert.equal(battle.drainEvents().filter(ev => ev[0] === 'fx' && ev[1] === 'zone').length, 2);
  }
});
