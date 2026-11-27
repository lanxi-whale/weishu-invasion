import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquireTargets } from '../game/server/sim/ai.js';
import { getVersionData } from '../game/server/data.js';
import { chessRec, enemyRec, flatStage, makeBattle } from '../game/test/helpers/battleHarness.js';

import { installInvasionMainBonds } from '../game/server/sim/battle/invasionBondsMain.js';

const data = getVersionData('act3autochess@V3_1');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' differs from ' + expected);
const seatOf = enemy => enemy?.invasionBonds?.seat ?? enemy?.sourcePlayerId;
const tiersOf = (...names) => Object.fromEntries(names.map(name => ['mon_main_' + name, 1]));

function makeField({ quotas = new Map(), stage, fieldId, defenderId = 'blue', placements = [['defender', 10, 5]] } = {}) {
  const archer = chessRec({
    id: 'test_ranged', profession: 'SNIPER', skill: null, stats: { atk: 1, maxHp: 10000, def: 0, res: 0, bat: 400 },
    rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]],
  });
  const api = {
    seat: seatOf,
    tier: (enemy, id) => enemy?.invasionBonds?.tiers[id] ?? 0,
    sameSeat: (first, second) => !!seatOf(first) && seatOf(first) === seatOf(second),
    take(enemy, key, limit = 1) {
      const quota = JSON.stringify([seatOf(enemy), key]);
      const used = quotas.get(quota) ?? 0;
      if (used >= limit) return false;
      quotas.set(quota, used + 1);
      return true;
    },
  };
  let incoming = null;
  const h = makeBattle({
    stage, fieldId, content: 'full', timeLimit: 50, hooks: ['statusApplied'],
    players: [{ playerId: defenderId, units: placements.map(([uid, row, col]) => ({ uid, chessId: archer.chessId, row, col })) }],
    defs: { chess: { [archer.chessId]: archer }, enemies: data.enemies },
    setup(battle) {
      // Supply the same metadata as the invasion spawn bridge before any native or bond handler sees the spawn.
      battle.on('enemySpawn', event => {
        if (!incoming || event.parent) return;
        Object.assign(event, { parent: incoming.parent, offspringKind: incoming.offspringKind });
        event.enemy.invasionBonds = incoming.bonds;
        incoming = null;
      }, { priority: 1000 });
      installInvasionMainBonds(battle, api);
    },
  });
  h.step();
  for (const ally of h.allies()) ally.atkCd = 500;
  function spawn(roles, {
    key = 'test_invader', seat = 'red', species = 'chess_mon_' + key, pos = [10, 6], gate = 'upper',
    atk = 100, def = 100, way = 'MELEE', fly = false, speed = 0, native = false, parent = null, offspringKind = null,
    members = Object.keys(roles),
  } = {}) {
    const bonds = { seat, species, tiers: roles, members, gate, ...(parent ? { offspring: true } : {}) };
    incoming = { bonds, parent, offspringKind };
    const route = { start: pos, end: pos, motion: fly ? 'FLY' : 'WALK', steps: [{ t: 'wait', s: 100 }] };
    const rec = enemyRec({ key, atk, def, speed, hp: 1000, range: way === 'RANGED' ? 3 : 0, applyWay: way, motion: route.motion });
    const enemy = h.spawn(key, { sourcePlayerId: seat, route, pos, ...(!native ? { def: rec } : {}), stats: { atk, moveSpeed: speed } });
    assert.ok(enemy, key);
    enemy.atkCd = 500;
    return enemy;
  }
  const hit = (source, target = h.unit('defender'), request = {}) =>
    h.b.dealDamage(source, target, { amount: source.s.atk, type: 'phys', isAttack: true, ...request });
  return { ...h, spawn, hit };
}

test('炎 only empowers native death artifacts and shares their quota between gates', () => {
  const h = makeField();
  const roles = tiersOf('yan');
  const nearby = h.spawn(roles, { pos: [10, 6] });
  const far = h.spawn(roles, { pos: [10, 3], key: 'test_far' });
  const other = h.spawn(roles, { pos: [10, 6], seat: 'other' });
  const parent = h.spawn(roles, { pos: [10, 7], key: 'test_parent' });
  h.b.kill(parent);
  const artifact = { key: 'enemy_1196_msfyin_2', pos: [10, 7], speed: 1, parent };
  const timed = h.spawn(roles, artifact);
  close(timed.s.moveSpeed, 1);
  const deathborn = () => h.spawn(roles, { ...artifact, offspringKind: 'death' });
  const first = deathborn();
  close(first.s.moveSpeed, 1.3);
  close(nearby.s.dmgDealtMul, 1.15);
  close(far.s.dmgDealtMul, 1);
  close(other.s.dmgDealtMul, 1);
  h.run(3);
  for (let i = 0; i < 4; i++) close(deathborn().s.moveSpeed, 1.3);
  close(h.spawn(roles, { ...artifact, gate: 'lower', offspringKind: 'death' }).s.moveSpeed, 1.3);
  close(deathborn().s.moveSpeed, 1);
  h.run(2);
  close(nearby.s.dmgDealtMul, 1.15);
  h.run(2.1);
  close(nearby.s.dmgDealtMul, 1);
  close(first.s.moveSpeed, 1);
});

test('海嗣 adds the same neural buildup at both tiers, including native aura damage', () => {
  for (const tier of [0, 1, 2]) {
    const h = makeField();
    const target = h.unit('defender');
    const roles = tier ? { mon_main_seaborn: tier } : {};
    const attacker = h.spawn(roles);
    h.hit(attacker);
    close(target.elem.neural, tier ? 10 : 0);

    h.spawn(roles, { key: 'enemy_1234_dsubrl', native: true });
    h.run(1.05);
    close(target.elem.neural, 5 + (tier ? 20 : 0));
    close(target.elem.erosion, 0);
    close(h.b.errorCount, 0);
  }
});

test('海嗣 scales only neural burst damage and stun, with one stun and the regular gauge cooldown', () => {
  for (const [tier, damage, duration] of [[0, 1000, 10], [1, 1200, 12], [2, 1500, 15]]) {
    const h = makeField();
    const roles = tier ? { mon_main_seaborn: tier } : {};
    const attacker = h.spawn(roles);
    const target = h.unit('defender');
    h.b.dealElementDamage({ source: null, credit: attacker, target, element: 'neural', amount: target.gaugeMax });

    close(target.stats.taken, damage);
    close(target.findBuff('neuralBurst').duration, 10);
    const stuns = h.hooksOf('statusApplied').filter(event => event.status === 'stun');
    assert.deepEqual(stuns.map(event => event.duration), [duration]);
    if (tier === 1) {
      h.b.kill(attacker);
      assert.equal(h.enemies().length, 0);
    }
    close(h.b.errorCount, 0);
  }
});

test('萨卡兹 marks on the first hit and spends its per-defender quota across fields', () => {
  const quotas = new Map();
  const h = makeField({ quotas });
  const roles = tiersOf('court');
  const first = h.spawn(roles);
  const same = h.spawn(roles);
  const other = h.spawn(roles, { seat: 'other' });
  const target = h.unit('defender');
  close(h.hit(first), 100);
  close(h.hit(same, target, { type: 'arts' }), 112);
  close(h.hit(same, target, { type: 'true' }), 100);
  close(h.hit(other), 100);
  h.run(5.1);
  close(h.hit(first), 100);
  close(h.hit(same), 100);
  const next = makeField({ quotas });
  const nextAttacker = next.spawn(roles);
  close(next.hit(nextAttacker), 100);
  close(next.hit(nextAttacker), 100);
  const newDefender = makeField({ quotas, defenderId: 'other-blue' });
  const newAttacker = newDefender.spawn(roles);
  close(newDefender.hit(newAttacker), 100);
  close(newDefender.hit(newAttacker), 112);
});

test('萨卡兹 treats runtime summons with reused engine IDs as distinct across fields', () => {
  const quotas = new Map();
  for (const fieldId of ['lane', 'joint']) {
    const h = makeField({ quotas, fieldId });
    const target = h.unit('defender');
    target.kind = 'token';
    target.uid = null;
    const attacker = h.spawn(tiersOf('court'));
    close(h.hit(attacker, target), 100);
    close(h.hit(attacker, target), 112);
  }
});

test('整合运动 pair buffs update as a same-seat ranged and melee ally enter and leave range', () => {
  const h = makeField();
  const roles = { mon_main_reunion: 2 };
  const melee = h.spawn(roles, { pos: [10, 6] });
  const ranged = h.spawn(roles, { way: 'RANGED', pos: [10, 8] });
  const other = h.spawn(roles, { way: 'RANGED', seat: 'other', pos: [10, 7] });
  h.step();
  close(ranged.s.atk, 120);
  close(other.s.atk, 100);
  close(h.b.dealDamage({ source: h.unit('defender'), target: melee, amount: 100, type: 'arts' }), 80);
  ranged.x = 10;
  h.step();
  close(ranged.s.atk, 100);
  close(h.b.dealDamage({ source: h.unit('defender'), target: melee, amount: 100, type: 'arts' }), 100);
});

test('深池 caps its same-seat nearby defense bonus at two different other species', () => {
  const h = makeField();
  const roles = { mon_main_abyss: 2 };
  const receiver = h.spawn(roles, { species: 'one' });
  h.spawn(roles, { species: 'one' });
  const two = h.spawn(roles, { species: 'two' });
  const duplicate = h.spawn(roles, { species: 'two' });
  const three = h.spawn(roles, { species: 'three' });
  h.spawn(roles, { species: 'four' });
  h.spawn(roles, { species: 'five', seat: 'other' });
  h.step();
  close(receiver.s.def, 140);
  h.b.kill(three);
  h.b.kill(h.enemies().find(enemy => enemy.invasionBonds.species === 'four'));
  h.step();
  close(receiver.s.def, 120);
  h.b.kill(two);
  duplicate.x = 9;
  h.step();
  close(receiver.s.def, 100);
});

test('无人机 protects the first per gate and sorts an active shield ahead of targetable drones', () => {
  const h = makeField();
  const roles = { mon_main_drone: 2 };
  const shielded = h.spawn(roles, { fly: true, pos: [10, 7] });
  const second = h.spawn({}, { fly: true, pos: [10, 6], seat: 'other', members: ['mon_main_drone'] });
  h.b.addBuff(second, { key: 'test:taunt', mods: { taunt: 1 } });
  const lower = h.spawn(roles, { fly: true, pos: [12, 7], gate: 'lower' });
  const defender = h.unit('defender');
  h.step();
  close(shielded.s.shield, 350);
  close(second.s.shield, 0);
  close(lower.s.shield, 350);
  const pick = () => acquireTargets(h.b, defender, defender.profile)[0]?.id;
  assert.equal(pick(), shielded.id);
  h.b.addBuff(shielded, { key: 'test:untargetable', flags: { untargetable: true } });
  assert.equal(pick(), second.id);
  h.b.removeBuff(shielded, 'test:untargetable');
  const ground = h.spawn({}, { pos: [10, 5] });
  h.b.addBuff(ground, { key: 'test:taunt', mods: { taunt: 2 } });
  h.step();
  assert.equal(pick(), ground.id);
  h.b.kill(ground);
  h.b.dealDamage({ source: defender, target: shielded, amount: 350, type: 'true' });
  assert.equal(pick(), second.id);
  h.run(6.1);
  close(lower.s.shield, 0);
});

test('感染 adds four plus-shaped periodic ticks and keeps the strongest overlapping tick', () => {
  const h = makeField({ placements: [['defender', 10, 5], ['edge', 10, 6], ['diagonal', 11, 6]] });
  const weak = h.spawn(tiersOf('infection'), { pos: [10, 5], atk: 100 });
  const strong = h.spawn({ mon_main_infection: 2 }, { pos: [10, 5], atk: 200, seat: 'other' });
  h.b.kill(weak);
  h.run(0.5);
  h.b.kill(strong);
  h.run(0.6);
  close(h.unit('defender').stats.taken, 44);
  close(h.unit('edge').stats.taken, 44);
  close(h.unit('diagonal').stats.taken, 0);
  h.run(4);
  close(h.unit('defender').stats.taken, 4 * 44);
  close(h.b.errorCount, 0);
});

test('萨卡兹·枯朽 adds 凋亡 only to ordinary hits in a pollution tile or next to an own-seat construct', () => {
  const stage = flatStage({ rows: { 10: '##hrrrrirrfrrrrrrrf##' } });
  const h = makeField({ stage });
  const attacker = h.spawn(tiersOf('decay'), { pos: [10, 7] });
  const target = h.unit('defender');
  h.hit(attacker, target, { isAttack: false, isSkill: true });
  close(target.elem.necrosis, 0);
  const first = attacker.s.atk * 0.12;
  h.b.addBuff(target, { key: 'test:shield', shield: 1000 });
  close(h.hit(attacker), 0);
  h.b.removeBuff(target, 'test:shield');
  close(target.elem.necrosis, first);
  attacker.x = 6;
  h.run(0.5);
  h.spawn({}, { key: 'enemy_1220_dzoms', pos: [10, 7], seat: 'other' });
  h.hit(attacker);
  close(target.elem.necrosis, first);
  h.spawn({}, { key: 'enemy_1221_dzomg_2', pos: [10, 7] });
  h.hit(attacker);
  close(target.elem.necrosis, first + attacker.s.atk * 0.12);
});

test('假想敌 checks live debuff source species and enforces one six-second proc per target', () => {
  const h = makeField();
  const roles = tiersOf('phantasm');
  const mirror = h.spawn(roles, { key: 'enemy_9039_acrefm', native: true });
  const attacker = h.spawn(roles, { key: 'test_swarm' });
  const sameSpecies = h.spawn(roles, { species: mirror.invasionBonds.species });
  const other = h.spawn(roles, { seat: 'other' });
  const target = h.unit('defender');
  h.b.dealDamage({ source: target, target: mirror, amount: 100, type: 'arts' });
  h.hit(sameSpecies);
  close(target.stats.taken, 100);
  h.hit(other);
  close(target.stats.taken, 200);
  h.hit(attacker);
  close(target.stats.taken, 325);
  h.hit(attacker);
  close(target.stats.taken, 425);
  h.run(6.1);
  h.hit(attacker);
  close(target.stats.taken, 525);
  h.b.dealDamage({ source: target, target: mirror, amount: 100, type: 'arts' });
  h.hit(attacker);
  close(target.stats.taken, 650);
});

test('巫王乐团 switches roles after four seconds with a seat-wide stun cap and repeats at tier II', () => {
  const quotas = new Map();
  const h = makeField({ quotas });
  const roles = { mon_main_witchking: 2 };
  const piper = h.spawn(roles, { native: true, key: 'enemy_1375_ltnclr' });
  const otherPiper = h.spawn(roles, { native: true, key: 'enemy_1375_ltnclr_2' });
  const horn = h.spawn(roles, { native: true, key: 'enemy_1373_ltnhor' });
  const drum = h.spawn(roles, { native: true, key: 'enemy_1376_ltndru' });
  close(piper.s.aspd, 100);
  close(horn.s.aspd, 100);
  close(drum.s.aspd, 100);
  h.run(4.1);
  close(piper.s.aspd, 75);
  close(horn.s.aspd, 150);
  close(drum.s.aspd, 150);
  h.hit(piper);
  h.hit(otherPiper);
  assert.equal(h.hooksOf('statusApplied').filter(event => event.status === 'stun').length, 1);
  h.run(7);
  close(piper.s.aspd, 100);
  close(drum.s.aspd, 100);
  h.run(5);
  close(piper.s.aspd, 75);
  h.hit(otherPiper);
  assert.equal(h.hooksOf('statusApplied').filter(event => event.status === 'stun').length, 2);
  close(h.b.errorCount, 0);

  const joint = makeField({ quotas, fieldId: 'unite' });
  const spent = joint.spawn(roles, { native: true, key: 'enemy_1376_ltndru' });
  const unspent = joint.spawn(roles, { native: true, key: 'enemy_1376_ltndru', seat: 'another' });
  joint.run(4.1);
  close(spent.s.aspd, 100);
  close(unspent.s.aspd, 150);
});

test('假想敌 recognizes a same-seat source after a poison caster dies and its cloud disappears on schedule', () => {
  const h = makeField();
  const roles = tiersOf('phantasm');
  const toxin = h.spawn(roles, { key: 'enemy_9006_actoxi', native: true, pos: [10, 5] });
  const attacker = h.spawn(roles);
  const target = h.unit('defender');
  h.b.kill(toxin);
  h.hit(attacker);
  close(target.stats.taken, 125);
  h.run(8.1);
  const before = target.stats.taken;
  h.hit(attacker);
  close(target.stats.taken - before, 100);
});

test('萨卡兹·枯朽 recognizes a native 污染秽蚀 death zone', () => {
  const h = makeField();
  const roles = { mon_main_decay: 2 };
  const donor = h.spawn(roles, { key: 'enemy_1267_nhpbr', native: true, pos: [10, 7] });
  const attacker = h.spawn(roles, { pos: [10, 7] });
  const target = h.unit('defender');
  h.hit(attacker);
  close(target.elem.necrosis, 0);
  h.b.kill(donor);
  h.hit(attacker);
  close(target.elem.necrosis, 22);
});

test('巫王乐团 activates the alternate attack effects of its horn and drum', () => {
  const h = makeField({ placements: [['defender', 10, 5], ['second', 11, 6]] });
  const roles = tiersOf('witchking');
  const horn = h.spawn(roles, { native: true, key: 'enemy_1373_ltnhor', pos: [10, 6] });
  const drum = h.spawn(roles, { native: true, key: 'enemy_1376_ltndru', pos: [10, 6] });
  const mainTarget = h.unit('defender');
  const landedTypes = [];
  h.b.on('damageApplied', ({ source, dmg }) => {
    if (source === horn) landedTypes.push(dmg.type);
  });
  const slatedTargets = attacker => h.b.emit('beforeAttack', { attacker, targets: [mainTarget], isSkill: false }).targets;
  close(drum.base.rangeRadius, 0);
  h.hit(horn);
  h.run(4.1);
  h.hit(horn);
  assert.deepEqual(landedTypes, ['phys', 'arts']);
  assert.ok(drum.base.rangeRadius > 0);
  for (const performer of [horn, drum]) {
    for (let i = 0; i < 2; i++) assert.deepEqual(slatedTargets(performer), [mainTarget]);
    assert.deepEqual(slatedTargets(performer), [mainTarget, h.unit('second')]);
  }
  h.run(5.1);
  close(drum.base.rangeRadius, 0);
  h.hit(horn);
  assert.deepEqual(landedTypes, ['phys', 'arts', 'phys']);
});

