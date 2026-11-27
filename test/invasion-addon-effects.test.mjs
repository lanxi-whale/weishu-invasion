import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getVersionData } from '../game/server/data.js';
import { Battle } from '../game/server/sim/Battle.js';
import { DataSource } from '../game/server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../game/server/sim/spec.js';
import { chessRec, enemyRec, flatStage } from '../game/test/helpers/battleHarness.js';

const stage = flatStage({ id: 'invasion-addon-test' });
const guard = chessRec({ id: 'addon_defender', stats: { maxHp: 10000, atk: 0, def: 50, res: 20, blockCnt: 5 }, skill: null });
const idle = enemyRec({ key: 'enemy_addon_idle', hp: 1000, dmgType: 'none' });
const flyer = enemyRec({ key: 'enemy_addon_flyer', hp: 1000, speed: 2, motion: 'FLY', dmgType: 'none' });
const data = new DataSource({
  stages: { [stage.id]: stage },
  chess: { [guard.chessId]: guard },
  enemies: { [idle.key]: idle, [flyer.key]: flyer },
}, new DataSource(getVersionData('act3autochess@V3_1')));

function field(positions = []) {
  const battle = new Battle({
    kind: 'normal', seed: 29, stageId: stage.id, data, autoFinish: false, devices: false, timeLimit: 50,
    rect: { r0: 9, r1: 12, c0: 3, c1: 10 },
    players: [{ playerId: 'defender', coords: 'field', units: positions.map(([row, col]) => ({ chessId: guard.chessId, row, col })) }],
  });
  battle.start();
  for (const ally of battle.allies()) ally.atkCd = 100;
  return battle;
}

function spawn(battle, role, tier, { key = idle.key, pos = [10, 8], stats, kind, motion = 'WALK' } = {}) {
  const route = { start: pos, end: pos, motion, steps: [{ t: 'wait', s: 50 }] };
  const id = 'mon_sub_' + role;
  const enemy = battle.spawnEnemy(key, {
    sourcePlayerId: 'attacker', pos, route, stats,
    invasion: kind ? { kind, gate: 'upper' } : null,
    invasionBonds: tier ? { tiers: { [id]: tier }, members: [id], seat: 'attacker', species: 'chess_mon_' + key, gate: 'upper' } : null,
  });
  enemy.atkCd = 100;
  return enemy;
}

function advance(battle, seconds) {
  const end = battle.time + seconds;
  while (!battle.finished && battle.time < end - 1e-9) battle.step();
  assert.equal(battle.errorCount, 0);
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' differs from ' + expected);

test('special shortens the first control that is actually applied', () => {
  const battle = field();
  const low = spawn(battle, 'special', 1);
  const high = spawn(battle, 'special', 2);
  battle.on('beforeStatus', c => { if (c.target === high && c.status === 'stun') c.cancel = true; }, { priority: -5000 });
  assert.equal(battle.applyStatus(high, 'stun', { duration: 4 }), false);
  assert.equal(battle.applyStatus(high, 'cold', { duration: 4 }), true);
  assert.equal(high.findBuff('cold').timeLeft, 4);
  assert.equal(battle.applyStatus(high, 'freeze', { duration: 4 }), true);
  close(high.findBuff('freeze').timeLeft, 2.2);
  assert.equal(battle.applyStatus(high, 'bind', { duration: 4 }), true);
  assert.equal(high.findBuff('bind').timeLeft, 4);
  battle.applyStatus(low, 'bind', { duration: 4 });
  assert.equal(low.findBuff('bind').timeLeft, 3);
});

test('fly activates after three seconds and restarts the delay even when a shield absorbs the hit', () => {
  const battle = field();
  const low = spawn(battle, 'fly', 1, { key: flyer.key, motion: 'FLY' });
  const high = spawn(battle, 'fly', 2, { key: flyer.key, motion: 'FLY' });
  advance(battle, 2.9);
  assert.equal(high.s.moveSpeed, 2);
  advance(battle, 0.15);
  close(low.s.moveSpeed, 2.3);
  assert.equal(high.s.moveSpeed, 2.5);
  const hp = high.hp;
  battle.addBuff(high, { key: 'test:shield', shield: 200 });
  battle.dealDamage({ source: null, target: high, amount: 100, type: 'true' });
  assert.equal(high.hp, hp);
  assert.equal(high.s.moveSpeed, 2);
  advance(battle, 3.05);
  assert.equal(high.s.moveSpeed, 2.5);
  battle.removeBuff(high, 'test:shield');
  battle.dealDamage({ source: null, target: high, amount: 100, type: 'true' });
  assert.equal(high.s.moveSpeed, 2);
  advance(battle, 2.9);
  assert.equal(high.s.moveSpeed, 2);
  advance(battle, 0.15);
  assert.equal(high.s.moveSpeed, 2.5);
  battle.applyStatus(high, 'invulnerable', { duration: 1 });
  assert.equal(battle.dealDamage({ source: null, target: high, amount: 100, type: 'true' }), 0);
  assert.equal(high.s.moveSpeed, 2.5);
});

test('times gives death-spawned tea vessels two more native arts hits at tier two', () => {
  const battle = field();
  const teapot = spawn(battle, 'times', 2, { key: 'enemy_1203_sfhu' });
  assert.equal(teapot.s.maxHp, 6500);
  battle.kill(teapot);
  const children = battle.aliveEnemies().filter(enemy => enemy.defId === 'enemy_1204_msfhu');
  assert.equal(children.length, 4);
  assert.ok(children.every(enemy => enemy.s.maxHp === 6 && enemy.hp === 6));
  const [tea] = children;
  assert.equal(battle.dealDamage({ target: tea, amount: 900, type: 'phys' }), 0);
  for (let i = 0; i < 5; i++) assert.equal(battle.dealDamage({ target: tea, amount: 900, type: 'arts' }), 1);
  assert.equal(tea.hp, 1);
  assert.equal(battle.dealDamage({ target: tea, amount: 1, type: 'true' }), 1);
  assert.equal(tea.alive, false);
});

test('times adds to each new native hit-count form without increasing regular health', () => {
  const battle = field();
  const enemy = spawn(battle, 'times', 1, { key: 'enemy_9010_acpupp' });
  battle.kill(enemy);
  assert.equal(enemy.hp, 16);
  advance(battle, 1.1);
  assert.equal(battle.dealDamage({ target: enemy, amount: 999, type: 'true' }), 1);
  assert.equal(enemy.hp, 15);
  advance(battle, 15.1);
  assert.equal(enemy.hp, 12000);
  battle.kill(enemy);
  assert.equal(enemy.hp, 16);
});

test('element amplifies the native rider and leaves supplemental gauge fills at their given value', () => {
  const battle = field([[10, 6]]);
  const enemy = spawn(battle, 'element', 2, { key: 'enemy_1148_dssbr', stats: { atk: 100 } });
  const target = battle.unitAt(10, 6);
  battle.dealDamage({ source: enemy, target, amount: 100, type: 'phys', isAttack: true });
  close(target.elem.neural, 18.75);
  battle.dealElementDamage({ source: enemy, target, element: 'neural', amount: 100, tags: ['invasionBond'] });
  close(target.elem.neural, 118.75);
});

test('dot amplifies each native bleed tick and leaves supplemental buff damage at its given value', () => {
  const battle = field([[10, 6]]);
  const enemy = spawn(battle, 'dot', 2, { key: 'enemy_1270_nhstlk' });
  const target = battle.unitAt(10, 6);
  battle.dealDamage({ source: enemy, target, amount: 100, type: 'phys', isAttack: true });
  assert.equal(target.hp, 9950);
  advance(battle, 2.05);
  assert.equal(target.hp, 9742);
  battle.dealDamage({ source: enemy, target, amount: 100, type: 'arts', attackType: 'BUFF', tags: ['dot', 'invasionBond'] });
  assert.equal(target.hp, 9662);
});

test('dot amplifies the native death cloud without changing its source-less damage', () => {
  const battle = field([[10, 6]]);
  const enemy = spawn(battle, 'dot', 1, { key: 'enemy_9006_actoxi', pos: [10, 6] });
  const target = battle.unitAt(10, 6);
  const sources = [];
  battle.on('damageApplied', ({ source, target: hit }) => { if (hit === target) sources.push(source); });
  battle.kill(enemy);
  advance(battle, 1.05);
  close(target.hp, 9944.8);
  assert.deepEqual(sources, [null]);
});

test('invisible deals native-type damage to every neighboring tile on real stealth changes', () => {
  const center = [10, 6];
  const nearby = [[9, 5], [9, 6], [9, 7], [10, 5], [10, 7], [11, 5], [11, 6], [11, 7]];
  const distant = [12, 6];
  const battle = field([...nearby, center, distant]);
  battle.applyStatus(battle.unitAt(...center), 'stun', { duration: 10 });
  const enemy = spawn(battle, 'invisible', 2, { key: 'enemy_1023_jmage', pos: center, stats: { atk: 400 } });
  const check = (hp) => {
    for (const tile of nearby) assert.equal(battle.unitAt(...tile).hp, hp, String(tile));
    assert.equal(battle.unitAt(...center).hp, 10000);
    assert.equal(battle.unitAt(...distant).hp, 10000);
  };
  check(9520);
  battle.addBuff(enemy, { key: 'test:anotherStealthSource', duration: 1.5, flags: { stealth: true } });
  check(9520);
  battle.addBuff(enemy, { key: 'test:attack', mods: { atkPct: 0.25 } });
  battle.applyStatus(enemy, 'reveal', { duration: 1 });
  check(8920);
  battle.applyStatus(enemy, 'reveal', { duration: 2 });
  check(8920);
  advance(battle, 2.05);
  check(8320);
});

test('invisible hits adjacent devices and waits for native stealth restoration', () => {
  const battle = field([[10, 6]]);
  const blocker = battle.unitAt(10, 6);
  const device = battle.spawnDevice('addon_device', 11, 5, { hp: 1000, blockCnt: 0 });
  const enemy = spawn(battle, 'invisible', 1, { key: 'enemy_1023_jmage', pos: [10, 6], stats: { atk: 100 } });
  assert.equal(device.hp, 900);
  battle.addBuff(enemy, { key: 'test:alsoStealth', duration: 10, flags: { stealth: true } });
  battle.step();
  assert.equal(enemy.blockedBy, blocker);
  assert.equal(device.hp, 800);
  battle.applyStatus(blocker, 'stun', { duration: 6 });
  assert.equal(device.hp, 800);
  advance(battle, 2.95);
  assert.equal(device.hp, 800);
  advance(battle, 0.1);
  assert.equal(device.hp, 700);
  assert.equal(blocker.hp, 10000);
});

test('invisible loses and restores native stealth at the respective block events', () => {
  const battle = field([[10, 6], [11, 5]]);
  const center = battle.unitAt(10, 6);
  const diagonal = battle.unitAt(11, 5);
  const enemy = spawn(battle, 'invisible', 1, { key: 'enemy_9008_acbunn', pos: [10, 6], stats: { atk: 100 } });
  assert.equal(diagonal.hp, 9920);
  battle.step();
  assert.equal(enemy.blockedBy, center);
  assert.equal(diagonal.hp, 9840);
  battle.applyStatus(center, 'stun', { duration: 2 });
  assert.equal(enemy.blockedBy, null);
  assert.equal(diagonal.hp, 9760);
  assert.equal(center.hp, 10000);
});

test('reflection uses real arts damage and shares a six-second cooldown per defender', () => {
  const battle = field([[10, 6], [10, 7]]);
  const first = battle.unitAt(10, 6);
  const second = battle.unitAt(10, 7);
  const a = spawn(battle, 'reflection', 1, { key: 'enemy_1165_duhond' });
  const b = spawn(battle, 'reflection', 2, { key: 'enemy_1165_duhond' });
  const c = spawn(battle, 'reflection', 2, { key: 'enemy_1165_duhond' });
  const hit = (source, target, type = 'arts') => battle.dealDamage({ source, target, amount: 10, type });
  advance(battle, 0.05);
  hit(first, a, 'phys');
  assert.equal(first.s.aspd, 100);
  battle.applyStatus(a, 'invulnerable', { duration: 0.1 });
  hit(first, a);
  assert.equal(first.s.aspd, 100);
  advance(battle, 0.15);
  hit(first, a);
  assert.equal(first.s.aspd, 85);
  hit(first, b);
  assert.equal(first.s.aspd, 85);
  hit(second, a);
  assert.equal(second.s.aspd, 100);
  hit(second, c);
  assert.equal(second.s.aspd, 75);
  advance(battle, 3.1);
  assert.equal(first.s.aspd, 100);
  hit(first, b);
  assert.equal(first.s.aspd, 100);
  advance(battle, 3.1);
  battle.applyStatus(b, 'silence', { duration: 0.4 });
  hit(first, b);
  assert.equal(first.s.aspd, 100);
  advance(battle, 0.45);
  hit(first, b);
  assert.equal(first.s.aspd, 75);
});

test('reflection restores the weaker bond slow after a stronger native slow expires', () => {
  const battle = field([[10, 6]]);
  const native = spawn(battle, 'reflection', 0, { key: 'enemy_9039_acrefm' });
  advance(battle, 0.05);
  const source = battle.unitAt(10, 6);
  battle.dealDamage({ source, target: native, amount: 100, type: 'arts' });
  assert.equal(source.s.aspd, 50);
  advance(battle, 1);
  const bonded = spawn(battle, 'reflection', 2, { key: 'enemy_1165_duhond' });
  advance(battle, 0.05);
  battle.dealDamage({ source, target: bonded, amount: 100, type: 'arts' });
  assert.equal(source.s.aspd, 50);
  advance(battle, 2.05);
  assert.equal(source.s.aspd, 75);
  advance(battle, 1.05);
  assert.equal(source.s.aspd, 100);
});

test('critic scales mitigated physical or arts damage below the strict HP threshold', () => {
  const battle = field([[10, 6]]);
  const enemy = spawn(battle, 'critic', 2);
  const target = battle.unitAt(10, 6);
  const hit = type => battle.dealDamage({ source: enemy, target, amount: 200, type });
  battle.dealHPLose({ target, amount: 6500 });
  assert.equal(target.hp, 3500);
  assert.equal(hit('phys'), 150);
  assert.equal(hit('phys'), 187.5);
  assert.equal(hit('arts'), 200);
  assert.equal(hit('true'), 200);
});

test('reborn heals true offspring each second for five seconds', () => {
  const battle = field();
  const parent = spawn(battle, 'reborn', 2, { key: 'enemy_1131_sbeast' });
  spawn(battle, 'reborn', 2, { key: 'enemy_10077_mpbarr', pos: [11, 8] });
  battle.dealHPLose({ target: parent, amount: 700 });
  advance(battle, 1.1);
  assert.equal(parent.hp, 2000);
  battle.kill(parent);
  advance(battle, 0.35);
  const child = battle.aliveEnemies().find(enemy => enemy.defId === 'enemy_1137_plasm');
  assert.ok(child);
  battle.dealHPLose({ target: child, amount: 600 });
  advance(battle, 1.05);
  assert.equal(child.hp, 470);
  advance(battle, 4.05);
  assert.equal(child.hp, 750);
  const minion = battle.aliveEnemies().find(enemy => enemy.defId === 'enemy_10073_mpcar');
  assert.ok(minion);
  battle.dealHPLose({ target: minion, amount: 600 });
  advance(battle, 1.2);
  assert.equal(minion.hp, 1400);
  assert.equal(child.hp, 750);
});

test('reborn also heals low-HP splits and completed in-place revivals', () => {
  const battle = field();
  const splitter = spawn(battle, 'reborn', 1, { key: 'enemy_1436_dsdivi' });
  const reborn = spawn(battle, 'reborn', 1, { key: 'enemy_1104_lfkght_3', pos: [11, 8] });
  battle.dealHPLose({ target: splitter, amount: 4800 });
  advance(battle, 0.4);
  const split = battle.aliveEnemies().find(enemy => enemy !== splitter && enemy.defId === splitter.defId);
  assert.ok(split);
  assert.equal(split.hp, 3200);
  advance(battle, 1.05);
  assert.equal(split.hp, 3520);
  assert.equal(splitter.hp, 3200);
  battle.kill(reborn);
  advance(battle, 5.1);
  assert.equal(reborn.hp, 20000);
  battle.dealHPLose({ target: reborn, amount: 10000 });
  advance(battle, 1.05);
  assert.equal(reborn.hp, 10800);
});

test('reborn restores a child summoned by a nearby defeat while its parent is alive', () => {
  const battle = field();
  const parent = spawn(battle, 'reborn', 2, { key: 'enemy_9030_acpara' });
  const victim = spawn(battle, 'reborn', 0, { pos: [10, 9] });
  battle.kill(victim);
  const child = battle.aliveEnemies().find(enemy => enemy.defId === 'enemy_1221_dzomg');
  assert.ok(child);
  assert.equal(parent.alive, true);
  battle.dealHPLose({ target: child, amount: 1500 });
  advance(battle, 1.05);
  assert.equal(child.hp, 1710);
});

test('serialized scheduled spawns keep their addon tier through BattleSpec replay', () => {
  const pos = [10, 8];
  const spawns = [{
    enemyKey: flyer.key, pos, time: 0, sourcePlayerId: 'attacker',
    route: { start: pos, end: pos, motion: 'FLY', steps: [{ t: 'wait', s: 50 }] },
    invasionBonds: { tiers: { mon_sub_fly: 2 }, members: ['mon_sub_fly'], seat: 'attacker', species: 'chess_mon_addon_flyer', gate: 'upper' },
  }];
  const spec = buildBattleSpec({
    kind: 'normal', seed: 1, round: 1, stageId: stage.id, timeLimit: 50, spawns,
    rect: { r0: 9, r1: 12, c0: 3, c1: 10 },
  });
  const battle = createBattleFromSpec(spec, data);
  advance(battle, 3.05);
  assert.equal(battle.aliveEnemies()[0].s.moveSpeed, 2.5);
});

test('native refraction slows preserve both invasion seats for the phantasm bond', () => {
  const battle = field([[10, 6]]);
  const defender = battle.unitAt(10, 6);
  function mirror(seat) {
    return battle.spawnEnemy('enemy_9039_acrefm', {
      pos: [10, 8], sourcePlayerId: seat,
      invasionBonds: { tiers: { mon_main_phantasm: 1 }, members: ['mon_main_phantasm'], seat, species: 'chess_mon_mirror', gate: 'upper' },
    });
  }
  const first = mirror('attacker');
  const second = mirror('attacker2');
  battle.dealDamage({ source: defender, target: first, amount: 10, type: 'arts' });
  battle.dealDamage({ source: defender, target: second, amount: 10, type: 'arts' });
  assert.equal(defender.s.aspd, 50);
  const sources = defender.findBuff('reg:refslow')?.data?.invasionSources;
  assert.equal(sources?.get('attacker')?.source, first);
  assert.equal(sources?.get('attacker2')?.source, second);
});
