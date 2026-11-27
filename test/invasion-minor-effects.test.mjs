import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Battle } from '../game/server/sim/Battle.js';
import { getVersionData } from '../game/server/data.js';
import { DataSource } from '../game/server/sim/simdata.js';
import { chessRec, enemyRec, flatStage } from '../game/test/helpers/battleHarness.js';

import { installInvasionMinorBonds } from '../game/server/sim/battle/invasionBondsMinor.js';

const va = new DataSource(getVersionData('act3autochess@V3_1'));
const stage = flatStage({ id: 'invasion-minor-test' });
const baseGuard = chessRec({ id: 'minor_guard', stats: { atk: 0, def: 0, maxHp: 50000, blockCnt: 0 }, skill: null });
const strongGuard = chessRec({ id: 'minor_strong', stats: { atk: 800, def: 0, maxHp: 50000, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null });
const blocker = chessRec({ id: 'minor_blocker', stats: { atk: 0, def: 0, maxHp: 50000, blockCnt: 2 }, skill: null });
const example = enemyRec({ key: 'enemy_minor_test', hp: 1000, atk: 100, def: 100, dmgType: 'none' });
const hunter = enemyRec({ key: 'enemy_minor_hunter', hp: 1000, atk: 100, range: 3, bat: 0.5 });
const data = new DataSource({
  stages: { [stage.id]: stage },
  chess: Object.fromEntries([baseGuard, strongGuard, blocker].map(r => [r.chessId, r])),
  enemies: Object.fromEntries([example, hunter].map(r => [r.key, r])),
}, va);

function fixture(defenders = [[11, 5]]) {
  const battle = new Battle({
    data, kind: 'normal', stageId: stage.id, seed: 3, round: 5, autoFinish: false, timeLimit: 60,
    rect: { r0: 9, r1: 12, c0: 2, c1: 10 },
    players: [{ playerId: 'defender', coords: 'field', units: defenders.map(([row, col, rec = baseGuard]) =>
      ({ chessId: rec.chessId, row, col })) }],
  });
  const seat = enemy => enemy?.invasionBonds ? enemy.sourcePlayerId : null;
  let metadata;
  battle.on('enemySpawn', ({ enemy }) => { enemy.invasionBonds = metadata; }, { priority: 1000 });
  installInvasionMinorBonds(battle, {
    seat,
    sameSeat(a, b) { return seat(a) != null && seat(a) === seat(b); },
    tier(enemy, id) { return enemy?.invasionBonds?.tiers?.[id] ?? 0; },
  });
  battle.start();
  function spawn(bond, { tier = 1, key = example.key, pos = [11, 7], source = 'a', species = key } = {}) {
    metadata = {
      gate: 'upper', species,
      tiers: bond ? { ['mon_minor_' + bond]: tier } : {},
    };
    const enemy = battle.spawnEnemy(key, {
      pos, route: { motion: data.getEnemy(key).motion, start: pos, end: pos, steps: [{ t: 'wait', s: 60 }] },
      sourcePlayerId: source,
    });
    battle._observeEnemyStealth(enemy, true);
    return enemy;
  }
  return { battle, spawn };
}

function advance(battle, seconds) {
  const end = battle.time + seconds;
  while (!battle.finished && battle.time < end - 1e-9) battle.step();
  assert.equal(battle.errorCount, 0, battle.errors.map(error => error.message).join(', '));
}

const hit = (battle, source, target, amount = 100, type = 'true', isAttack = true) =>
  battle.dealDamage({ source, target, amount, type, isAttack });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, String(actual) + ' vs ' + expected);

test('snow applies cold once per species and defender and a distinct species can freeze', () => {
  const { battle, spawn } = fixture([[11, 5], [11, 6]]);
  const first = spawn('snow', { species: 'first' });
  const duplicate = spawn('snow', { species: 'first' });
  const second = spawn('snow', { species: 'second' });
  const anotherSeat = spawn('snow', { species: 'first', source: 'b' });
  const target = battle.unitAt(11, 5);
  const other = battle.unitAt(11, 6);
  hit(battle, first, target);
  assert.equal(target.s.flags.cold, true);
  near(target.findBuff('cold').timeLeft, 3);
  hit(battle, duplicate, target);
  assert.equal(target.s.flags.freeze, undefined);
  hit(battle, duplicate, other);
  assert.equal(other.s.flags.cold, true);
  hit(battle, second, target);
  assert.equal(target.s.flags.freeze, true);
  advance(battle, 3.1);
  hit(battle, first, target);
  assert.equal(target.s.flags.cold, undefined);
  hit(battle, anotherSeat, target);
  assert.equal(target.s.flags.cold, true);
});

test('special triggers only below half health and lasts four seconds at each tier', () => {
  for (const [tier, speed] of [[1, 1.2], [2, 1.35]]) {
    const { battle, spawn } = fixture();
    const enemy = spawn('special', { tier });
    hit(battle, null, enemy, 500);
    near(enemy.s.moveSpeed, 1);
    battle.dealHPLose({ target: enemy, amount: 1 });
    near(enemy.s.moveSpeed, speed);
    advance(battle, 4.1);
    battle.heal({ target: enemy, amount: 500 });
    hit(battle, null, enemy, 505);
    near(enemy.s.moveSpeed, 1);
  }
});

test('carnival cheers nearby same-seat creatures on first stealth loss or a balloon knockout', () => {
  const { battle, spawn } = fixture();
  const performer = spawn('carnival', { key: 'enemy_10031_cnvsld' });
  const nearby = spawn(null, { pos: [11, 9] });
  const distant = spawn(null, { pos: [9, 5] });
  const foreign = spawn(null, { source: 'b' });
  const balloon = spawn('carnival', { key: 'enemy_10040_cnvbln' });
  const later = spawn('carnival', { key: 'enemy_10040_cnvbln' });
  battle.applyStatus(performer, 'reveal', { duration: 0.5 });
  assert.equal(nearby.s.aspd, 120);
  assert.equal(distant.s.aspd, 100);
  assert.equal(foreign.s.aspd, 100);
  advance(battle, 4.1);
  battle.kill(balloon);
  assert.equal(nearby.s.aspd, 100);
  advance(battle, 4);
  battle.applyStatus(performer, 'reveal', { duration: 0.5 });
  assert.equal(nearby.s.aspd, 100);
  battle.kill(later);
  assert.equal(nearby.s.aspd, 120);
});

test('Sankta rallies when fear ends and when a native ammunition spend occurs', () => {
  const { battle, spawn } = fixture();
  const flyer = spawn('sankta', { tier: 2 });
  const swordsman = spawn('sankta', { key: 'enemy_10087_hlchgr' });
  battle.applyStatus(flyer, 'fear', { source: flyer, duration: 1 });
  assert.equal(flyer.s.aspd, 100);
  advance(battle, 1.1);
  near(flyer.s.moveSpeed, 1.25);
  assert.equal(flyer.s.aspd, 125);
  battle.applyStatus(flyer, 'fear', { source: flyer, duration: 0.3 });
  advance(battle, 4);
  assert.equal(flyer.s.aspd, 100);
  advance(battle, 1.1);
  assert.equal(swordsman.s.aspd, 115);
  near(swordsman.s.moveSpeed, 1.2 * 1.2 * 1.15);
});

test('theater camera covers the center and four adjacent tiles once per seat', () => {
  for (const [tier, multiplier, duration] of [[1, 1.15, 5], [2, 1.25, 8]]) {
    const { battle, spawn } = fixture([[10, 5], [10, 6], [11, 6], [12, 8]]);
    const actor = spawn('theater', { tier });
    const foreign = spawn('theater', { source: 'b', tier });
    const center = battle.unitAt(10, 5);
    const neighbor = battle.unitAt(10, 6);
    const diagonal = battle.unitAt(11, 6);
    const distant = battle.unitAt(12, 8);
    hit(battle, actor, center);
    const neural = (source, target) => battle.dealElementDamage({ source, target, amount: 100, element: 'neural' });
    near(neural(actor, center), 100 * multiplier);
    near(neural(actor, neighbor), 100 * multiplier);
    near(neural(actor, diagonal), 100);
    near(neural(foreign, neighbor), 100);
    advance(battle, duration - 0.1);
    near(neural(actor, neighbor), 100 * multiplier);
    advance(battle, 0.2);
    hit(battle, actor, distant);
    near(neural(actor, distant), 100);
    near(neural(actor, neighbor), 100);
  }
});

test('theater camera enables an existing actor’s longer range and double hit', () => {
  const { battle, spawn } = fixture([[10, 5], [10, 7]]);
  const protagonist = spawn('theater', { key: 'enemy_10098_crhro', pos: [10, 4] });
  const antagonist = spawn('theater', { key: 'enemy_10099_crvln', pos: [10, 4] });
  const actor = spawn('theater');
  hit(battle, actor, battle.unitAt(10, 5));
  const hits = [];
  battle.on('damageApplied', ({ source, target }) => {
    if (source === protagonist || source === antagonist) hits.push([source.id, target.tileC]);
  });
  advance(battle, 2);
  assert.deepEqual(hits.filter(([id]) => id === protagonist.id), [[protagonist.id, 7]]);
  assert.deepEqual(hits.filter(([id]) => id === antagonist.id), [[antagonist.id, 7], [antagonist.id, 7]]);
});

test('prisoner shortens the existing confinement counter and tier two restores missing HP on liberation', () => {
  for (const [tier, attacks, after] of [[1, 3, 2000], [2, 2, 2875]]) {
    const { battle, spawn } = fixture();
    const enemy = spawn('prisoner', { key: 'enemy_1116_liprr', tier });
    const defender = battle.unitAt(11, 5);
    battle.dealHPLose({ target: enemy, amount: enemy.s.maxHp - 2000 });
    for (let i = 0; i < attacks - 1; i++) battle.emit('beforeAttack', { attacker: enemy, targets: [defender], isSkill: false });
    assert.equal(enemy.form, 'warning');
    battle.emit('beforeAttack', { attacker: enemy, targets: [defender], isSkill: false });
    assert.equal(enemy.form, 'liberty');
    assert.equal(enemy.hp, after);
  }
});

test('arc gives three reductions and shortens the displacement attached to the third hit', () => {
  const { battle, spawn } = fixture();
  const enemy = spawn('arc', { pos: [10, 4] });
  const ordinary = spawn(null, { pos: [10, 4] });
  const op = battle.unitAt(11, 5);
  const normalDistance = battle.pushDistance(ordinary, 2);
  for (let i = 0; i < 3; i++) near(hit(battle, op, enemy), 80);
  near(battle.pushDistance(enemy, 2), 0.75 * normalDistance);
  near(battle.pull(enemy, 2, { to: { x: 7, y: 10 }, stop: 0 }), 2.25);
  near(hit(battle, op, enemy), 100);
  near(battle.pushDistance(enemy, 2), normalDistance);
  near(battle.displace(enemy, { x: -1, y: 0 }, 1), 1);
});

test('visitor covers the first knockout cross and only its own visitors gain zone defenses', () => {
  for (const [tier, def, res, duration] of [[1, 115, 0, 4], [2, 125, 8, 6]]) {
    const { battle, spawn } = fixture();
    const options = { tier };
    const victim = spawn('visitor', options);
    const inside = spawn('visitor', { ...options, pos: [11, 8] });
    const diagonal = spawn('visitor', { ...options, pos: [10, 8] });
    const foreign = spawn('visitor', { ...options, source: 'b' });
    battle.kill(victim);
    near(inside.s.def, def);
    assert.equal(inside.s.res, res);
    assert.equal(diagonal.s.def, 100);
    assert.equal(foreign.s.def, 100);
    advance(battle, duration + 0.1);
    assert.equal(inside.s.def, 100);
    battle.kill(diagonal);
    assert.equal(inside.s.def, 100);
  }
});

test('Rhine adapts after first real physical or arts damage and only against the selected type', () => {
  for (const [tier, normal, duration] of [[1, 80, 6], [2, 65, 8]]) {
    const { battle, spawn } = fixture();
    const enemy = spawn('rhine', { tier });
    const source = battle.unitAt(11, 5);
    const damage = (type, amount = 100) => hit(battle, source, enemy, amount, type);
    assert.equal(damage('true'), 100);
    battle.addBuff(enemy, { key: 'testShield', shield: 150 });
    assert.equal(damage('phys', 200), 0);
    assert.equal(damage('arts', 150), 100);
    assert.equal(damage('phys', 200), 100);
    near(damage('arts'), normal);
    advance(battle, duration + 0.1);
    assert.equal(damage('arts'), 100);
  }
});

test('knights heal and pick the highest-ATK selectable candidate after the first own knockout', () => {
  const { battle, spawn } = fixture([[10, 4, strongGuard], [10, 6]]);
  const victim = spawn('knight');
  const knight = spawn('knight', { key: hunter.key, pos: [10, 5] });
  const foreign = spawn('knight', { source: 'b' });
  const second = spawn('knight');
  const high = battle.unitAt(10, 4);
  const low = battle.unitAt(10, 6);
  battle.dealHPLose({ target: knight, amount: 300 });
  battle.dealHPLose({ target: foreign, amount: 300 });
  battle.kill(victim);
  assert.equal(knight.hp, 850);
  assert.equal(foreign.hp, 700);
  battle.kill(second);
  assert.equal(knight.hp, 850);
  const targets = [];
  battle.on('damageApplied', ({ source, target }) => { if (source === knight) targets.push(target); });
  advance(battle, 0.3);
  assert.equal(targets[0], high);
  battle.addBuff(high, { key: 'testStealth', flags: { stealth: true }, duration: 10 });
  advance(battle, 0.7);
  assert.equal(targets.at(-1), low);
  battle.removeBuff(high, 'testStealth');
  advance(battle, 4.2);
  assert.equal(targets.at(-1), low);
});

test('knight rally counts the first knockout which starts a native rebirth', () => {
  const { battle, spawn } = fixture();
  const reborn = spawn('knight', { key: 'enemy_1104_lfkght_3' });
  const survivor = spawn('knight');
  const next = spawn('knight');
  battle.dealHPLose({ target: survivor, amount: 400 });
  battle.kill(reborn);
  assert.equal(reborn.alive, true);
  assert.equal(reborn.form, 'reborn');
  assert.equal(survivor.hp, 750);
  battle.kill(next);
  assert.equal(survivor.hp, 750);
});

test('water adds erosion only on normal hits and tier two speeds nearby own water members on the burst', () => {
  const { battle, spawn } = fixture();
  const target = battle.unitAt(11, 5);
  const source = spawn('water', { tier: 2, pos: [11, 6] });
  const firstTier = spawn('water', { pos: [11, 5] });
  const nearby = spawn('water', { tier: 2, pos: [11, 7] });
  const distant = spawn('water', { tier: 2, pos: [11, 8] });
  const foreign = spawn('water', { tier: 2, pos: [11, 5], source: 'b' });
  hit(battle, firstTier, target);
  assert.equal(target.elem.erosion, 8);
  hit(battle, source, target, 100, 'true', false);
  assert.equal(target.elem.erosion, 8);
  hit(battle, source, target);
  assert.equal(target.elem.erosion, 23);
  battle.dealElementDamage({ amount: 967, element: 'erosion', target });
  hit(battle, source, target);
  assert.equal(target.s.flags.burstLock, true);
  for (const enemy of [source, nearby]) near(enemy.s.moveSpeed, 1.2);
  for (const enemy of [distant, foreign]) near(enemy.s.moveSpeed, 1);
  advance(battle, 4.1);
  near(nearby.s.moveSpeed, 1);
});

test('water normal attacks carry erosion through an HP shield', () => {
  const { battle, spawn } = fixture();
  const source = spawn('water');
  const target = battle.unitAt(11, 5);
  battle.addBuff(target, { key: 'testShield', shield: 100 });
  assert.equal(hit(battle, source, target), 0);
  assert.equal(target.elem.erosion, 8);
});

test('pathfinder reloads exactly one native shot after the first empty magazine', () => {
  for (const [tier, delay] of [[1, 4], [2, 2]]) {
    const { battle, spawn } = fixture([[10, 5]]);
    const enemy = spawn('pathfinder', { key: 'enemy_1219_mtrbty', tier, pos: [10, 4] });
    const max = battle.unitAt(10, 5).hp;
    advance(battle, 1.2);
    assert.equal(battle.unitAt(10, 5).hp, max - 900);
    assert.equal(enemy.profile.melee, true);
    advance(battle, delay + 0.9);
    assert.equal(battle.unitAt(10, 5).hp, max - 1800);
    assert.equal(enemy.profile.melee, true);
    advance(battle, 6);
    assert.equal(battle.unitAt(10, 5).hp, max - 1800);
  }
});

test('pathfinder upgrades the frontliner’s first blocked hit once per body', () => {
  for (const [tier, multiplier] of [[1, 1.15], [2, 1.25]]) {
    const { battle, spawn } = fixture([[11, 5, blocker]]);
    const target = battle.unitAt(11, 5);
    const enemy = spawn('pathfinder', { key: 'enemy_1406_chghmr', tier, pos: [11, 5] });
    advance(battle, 0.1);
    assert.equal(enemy.blockedBy, target);
    near(hit(battle, enemy, target, 100, 'phys'), 450 * multiplier);
    near(hit(battle, enemy, target, 100, 'phys'), 100);
    battle.releaseBlocked(target);
    advance(battle, 0.1);
    near(hit(battle, enemy, target, 100, 'phys'), 450);
  }
});
