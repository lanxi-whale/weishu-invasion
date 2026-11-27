// server/sim/content/enemies/regulation.js — 规程·序列Ⅰ special enemies (CRITIC / REBORN and the new draws).
//
// Kept off KITS: test/content/enemies_bosses.test.js requires every KITS key in the default enemies.json.
// enemies.js onSpawn falls back to REGULATION_KITS. This module does not import enemies.js.
//
// Official numbers are read from the enemy record. Points with no blackboard are marked [ASSUMED].

import { hypot, sin, cos } from '../../detmath.js';
import { ALLY_COLLIDER_RADIUS, COLS, MAX_BATTLE_TIME } from '../../constants.js';
import { periodicDamage } from '../../attack.js';
import { tryWitchkingStun, witchkingVariation } from '../../battle/invasionBondsMain.js';
import {
  hurt, elem, areaAllies, auraAllies, remainingRoute, spawnChildren, nthOf, canCast, BOOM_RADIUS, auraBuff, watchDeaths,
  unbalancedNow, castSlot, targetsNear, byPriority,
} from './helpers.js';
import { skill, stealth, ep, refraction, reborn, deathBoom } from './archetypes.js';
import { summonAfterDeath } from './invasionSummons.js';

const num = (v, d) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) return +v;
  return d;
};
const tv = (ab, key, d) => num(ab && ab.t ? ab.t[key] : undefined, d);
const sv = (map, key) => {
  const v = map && map[key];
  return typeof v === 'string' && v ? v : '';
};
const bb = (sk, key, d) => num(sk && sk.bb ? sk.bb[key] : undefined, d);

function spEvery(sk, fire, sil = false) {
  if (!sk || !(sk.sp > 0)) return null;
  return {
    sk, sil,
    tick(b, e, a, dt) {
      if (!canCast(e, sil, b)) return;
      a.acc = (a.acc ?? 0) + dt;
      if (a.acc + 1e-9 < sk.sp) return;
      a.acc = 0;
      fire(b, e, a);
    },
  };
}

function timed(sk, fire, extra = {}) {
  if (!sk || !fire) return null;
  if (sk.sp > 0 && !(sk.cd > 0)) return spEvery(sk, fire, !!extra.sil);
  if (sk.cd > 0) return skill(sk, fire, extra);
  return null;
}

function nearestAlly(b, src, from, range, seen) {
  let best = null;
  let bd = range;
  for (const u of areaAllies(b, src, from.x, from.y, range)) {
    if (!u || seen.has(u.id)) continue;
    const d = hypot(u.x - from.x, u.y - from.y);
    if (d > range + 1e-9) continue;
    if (!best || d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && u.id < best.id)) { best = u; bd = d; }
  }
  return best;
}

// --- CRITIC ----------------------------------------------------------------------------------------------

/** 战线推进者: the first attack after each block is ×sheltr ×(1+atk). PowerHit is not a cooldown. */
function kitChghmr(ab) {
  const sheltr = tv(ab, 'DmgUp.sheltr_atk_scale', 2.5);
  const atk = bb(ab.sk.PowerHit, 'atk', 0.8);
  return [{
    sil: true,
    blocked(c, b, e, a) { a.armed = true; },
    hitOut(c, b, e, a) {
      if (!a.armed || !c.dmg || !c.dmg.isAttack) return;
      a.armed = false;
      c.dmg.mul *= sheltr * (1 + atk);
    },
  }];
}

/** 管乐家 stores ATK while unblocked. The invasion variation uses its native stun duration. */
function kitLtnclr(ab) {
  const flat = tv(ab, 'atkboostCore.atk', 30);
  const cap = tv(ab, 'atkboostCore.max_stack_count', 30);
  const stun = tv(ab, 'atkboostCore.attack@stun_duration', 10);
  return [{
    tick(b, e, a, dt) {
      if (e.blockedBy) return;
      a.acc = (a.acc ?? 0) + dt;
      if (a.acc + 1e-9 < 1) return;
      a.acc -= 1;
      a.stacks = Math.min(cap, (a.stacks ?? 0) + 1);
      b.addBuff(e, { key: 'reg:boost', persist: true, refresh: 'replace', mods: { atkFlat: flat * a.stacks } });
    },
    dealt(c, b, e, a) {
      const variation = witchkingVariation(e);
      const mayStun = variation ? c.target?.hp > 0 : a.stacks > 0;
      if (stun > 0 && c.target?.alive && mayStun) {
        tryWitchkingStun(b, e, c.target, stun);
      }
      if (a.stacks > 0) {
        a.stacks = 0;
        b.removeBuff(e, 'reg:boost');
      }
    },
  }];
}

function kitWitchkingAttack(ab, role = 'horn') {
  const drum = role === 'drum';
  const slot = drum ? ab.sk.aoeAttack_enthu : ab.sk.attackTwoTarget_enthu;
  if (!slot) return [];
  return [{
    hitOut(c, b, e) {
      if (!drum && c.dmg.isAttack && witchkingVariation(e)?.mode === 'enthu') c.dmg.type = 'arts';
    },
    before(c, b, e, a) {
      const variation = witchkingVariation(e);
      const target = c.targets[0];
      if (variation?.mode !== 'enthu' || !target?.alive) return;
      if (a.variation !== variation) { a.variation = variation; a.turns = 0; }
      if (++a.turns < nthOf(slot)) return;
      a.turns = 0;
      castSlot(b, e, slot);
      const others = byPriority(e, targetsNear(b, e, e.base.rangeRadius + ALLY_COLLIDER_RADIUS).filter(unit => unit !== target));
      c.targets = [target, ...(drum ? others : others.slice(0, 1))];
    },
  }];
}

/** “投石机”: the first attack is ×scale, then it only melee-attacks. The handbook cross has no radius. */
function kitWingnt(ab) {
  const scale = tv(ab, 'FirstAttack.attack@first_atk_scale', 1.5);
  return [{
    hitOut(c, b, e, a) {
      if (a.used || !c.dmg || !c.dmg.isAttack) return;
      a.used = true;
      c.dmg.mul *= scale;
      e.profile.melee = true;
    },
  }];
}

/** 冰原卫法者: silenced death boom (cold and freeze); unbalanced self HP loss is not silenced. */
function kitKrgrg(ab) {
  const scale = tv(ab, 'boom.atk_scale', 1);
  const cold = tv(ab, 'boom.cold', 0);
  const freeze = tv(ab, 'boom.freeze', 0);
  const bleed = tv(ab, 'unbalanced_bleed.damage', 0);
  const iv = tv(ab, 'unbalanced_bleed.interval', 0.066);
  return [
    {
      sil: true,
      death(c, b, e) {
        if (c.reason !== 'killed') return;
        for (const u of areaAllies(b, e, e.x, e.y, BOOM_RADIUS)) {
          if (scale > 0) hurt(b, e, u, e.s.atk * scale, 'arts');
          if (!u.alive) continue;
          if (cold > 0) b.applyStatus(u, 'cold', { duration: cold, source: e });
          if (freeze > 0 && u.alive) b.applyStatus(u, 'freeze', { duration: freeze, source: e });
        }
      },
    },
    {
      tick(b, e, a, dt) {
        if (!(bleed > 0) || !(iv > 0) || !unbalancedNow(b, e)) return;
        a.acc = (a.acc ?? 0) + dt;
        for (let n = 0; n < 4 && a.acc + 1e-9 >= iv && e.alive; n++) {
          a.acc -= iv;
          b.dealHPLose(e, bleed);
        }
      },
    },
  ];
}

// Invasion reloads the existing magazine on the committed attack frame, including a missed projectile.
function stockedPathfinder(enemy, scale, headshot = null) {
  const stock = enemy.def.raw?.sp;
  if (!(stock?.maxSp > 0)) return [];
  const switchMelee = enemy.def.applyWay === 'ALL';
  const loadedAttacks = new Set();
  const headshots = new WeakSet();
  let left = Math.min(stock.maxSp, stock.initSp ?? stock.maxSp);
  return [{
    spawn(b, e) {
      if (switchMelee) e.profile.melee = left <= 0;
      b.on('enemyAttackCommitted', ({ enemy: attacker, attackId }) => {
        if (attacker !== e || left <= 0) return;
        loadedAttacks.add(attackId);
        if (--left === 0 && switchMelee) e.profile.melee = true;
        const refill = () => {
          left = Math.min(stock.maxSp, left + 1);
          if (switchMelee) e.profile.melee = left <= 0;
        };
        if (b.hasHook('enemyAmmoUsed')) b.emit('enemyAmmoUsed', { enemy: e, left, refill });
      }, { owner: e });
    },
    hitOut(c) {
      if (!c.dmg.isAttack || !loadedAttacks.delete(c.dmg.attackId)) return;
      c.dmg.mul *= scale;
      headshots.add(c.dmg);
    },
    dealt(c, b, e) {
      if (headshot && headshots.has(c.dmg)) headshot(c, b, e);
    },
  }];
}

function kitPathfinderMagazine(ab, e) {
  if (!e.invasionBonds?.tiers?.mon_minor_pathfinder) return [];
  return stockedPathfinder(e, tv(ab, 'shotbuff.attack@headshot_atk_scale', 1));
}

/** 寻路者信使: one headshot, then melee. */
function kitMtrbty(ab, enemy) {
  const scale = tv(ab, 'shotbuff.attack@headshot_atk_scale', 1.5);
  const disarm = tv(ab, 'shotbuff.attack@headshot_disarmed_duration', 15);
  const sp = tv(ab, 'shotbuff.attack@headshot_sp', -1);
  const trap = tv(ab, 'shotbuff.attack@headshot_trapdamage', 5000);
  function headshot(c, b, e) {
    const u = c.target;
    if (disarm > 0 && u.alive) b.applyStatus(u, 'disarm', { duration: disarm, source: e });
    if (u.skill && sp !== 0) u.skill.sp = Math.max(0, (u.skill.sp ?? 0) + sp);
    if (trap > 0 && u.kind === 'device' && u.alive) hurt(b, e, u, trap, 'arts');
  }
  if (enemy.invasionBonds?.tiers?.mon_minor_pathfinder) return stockedPathfinder(enemy, scale, headshot);
  return [{
    hitOut(c, b, e, a) {
      if (a.spent || !c.dmg || !c.dmg.isAttack) return;
      a.spent = true;
      c.dmg.mul *= scale;
      e.profile.melee = true;
    },
    dealt(c, b, e, a) {
      if (a.paid || !c.target) return;
      a.paid = true;
      headshot(c, b, e);
    },
  }];
}

/** 马特奥的近卫: two phys shots down a shared row or column. Unblocked damage resistance. */
function kitBdguad(ab) {
  const sk = ab.sk.CrossBomb;
  const dr = tv(ab, 'DmgResist.damage_resistance', 0.4);
  return [
    sk && skill(sk, (b, e) => {
      const range = bb(sk, 'projectile_range', 1.1);
      const times = Math.max(1, Math.min(4, bb(sk, 'times', 2)));
      const scale = bb(sk, 'atk_scale', 0.5);
      let best = null;
      let bd = Infinity;
      for (const u of b.allies()) {
        if (!u.alive) continue;
        const line = Math.abs(u.y - e.y) < 0.5 || Math.abs(u.x - e.x) < 0.5;
        if (!line) continue;
        const d = hypot(u.x - e.x, u.y - e.y);
        if (d > range + 1e-9) continue;
        if (!best || d < bd || (d === bd && u.id < best.id)) { best = u; bd = d; }
      }
      if (!best) return;
      const shot = () => { if (best.alive) hurt(b, e, best, e.s.atk * scale, 'phys'); };
      shot();
      for (let i = 1; i < times; i++) b.after(0.3 * i, shot);
    }, {
      sil: true,
      cond: (b, e) => {
        const range = bb(sk, 'projectile_range', 1.1);
        for (const u of b.allies()) {
          if (!u.alive) continue;
          const line = Math.abs(u.y - e.y) < 0.5 || Math.abs(u.x - e.x) < 0.5;
          if (line && hypot(u.x - e.x, u.y - e.y) <= range + 1e-9) return true;
        }
        return false;
      },
    }),
    {
      hitIn(c, b, e) {
        if (e.blockedBy) return;
        const ty = c.dmg && c.dmg.type;
        if (ty !== 'phys' && ty !== 'arts') return;
        c.dmg.mul *= Math.max(0, 1 - dr);
      },
    },
  ];
}

/** 魂灵法骸: the cooldown stands in for one orbiting fragment (no stage-prop pickup). [ASSUMED] */
function kitLrmzrd(ab) {
  const sk = ab.sk.summonFireball;
  const scale = bb(sk, 'atk_scale', 1);
  const maxN = bb(sk, 'max_projectile_count', 3);
  return [
    {
      tick(b, e, a, dt) {
        const list = e.mem.regFrags;
        if (!list || !list.length) return;
        const next = [];
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          f.ang += 2 * dt;
          const x = e.x + cos(f.ang) * 1;
          const y = e.y + sin(f.ang) * 1;
          let spent = false;
          for (const u of areaAllies(b, e, x, y, 0.4)) {
            hurt(b, e, u, e.s.atk * f.scale, 'arts');
            spent = true;
            break;
          }
          if (!spent) next.push(f);
        }
        e.mem.regFrags = next;
      },
    },
    timed(sk, (b, e) => {
      const list = e.mem.regFrags || (e.mem.regFrags = []);
      if (list.length >= maxN) return;
      list.push({ ang: list.length * 2.094, scale });
    }),
  ];
}

/** 假想敌：丛生: the first damage to each target is doubled, then that target cannot be healed. */
function kitAccrit(ab) {
  const scale = tv(ab, 'CriticalHit.damage_scale', 2);
  const dur = tv(ab, 'CriticalHit.duration', 5);
  return [{
    spawn(b, e, a) { a.seen = {}; },
    hitOut(c, b, e, a) {
      const t = c.target;
      if (!t || !c.dmg || a.seen[t.id]) return;
      a.seen[t.id] = true;
      c.dmg.mul *= scale;
      if (dur > 0) applyPhantasmDebuff(b, e, t, { key: 'reg:crit', duration: dur, flags: { healFree: true, noHeal: true } });
    },
  }];
}

// --- REBORN (death replacement — not the reborn() archetype, except 1104_3) ----------------------------

function auraOf(b, e, ab) {
  const key = sv(ab.tS, 'deathrattle.enemy_key');
  const step = tv(ab, 'aura.atk', 0);
  const cap = tv(ab, 'aura.max_valid_stack_cnt', 6);
  if (!key || !(step > 0)) return;
  let n = 0;
  for (const o of b.aliveEnemies()) if (o.defId === key) n++;
  n = Math.min(cap, n);
  if (n > 0) b.addBuff(e, { key: 'reg:lord', duration: 0.35, refresh: 'replace', mods: { atkPct: step * n } });
  else b.removeBuff(e, 'reg:lord');
}

function kitDklord(ab, enemy) {
  const key = sv(ab.tS, 'deathrattle.enemy_key') || enemy.def.raw.summons?.[0];
  const delay = tv(ab, 'deathrattle.delay', 1);
  return [{
    tick(b, e) { auraOf(b, e, ab); },
    death(c, b, e) { if (c.reason === 'killed') summonAfterDeath(b, e, key, delay); },
  }];
}

/** 责罚者: spCost 3 reads as the 4th attack (nthOf). Splash stun. Death key is Attack.enemy_key; delay [ASSUMED] 1s. */
function kitDfat(ab, enemy) {
  const sk = ab.sk.StunAttack;
  const n = nthOf(sk);
  const dur = bb(sk, 'stun', 4);
  const key = sv(ab.tS, 'Attack.enemy_key') || enemy.def.raw.summons?.[0];
  return [
    {
      sil: true,
      attack(c, b, e, a) {
        a.n = (a.n ?? 0) + 1;
        if (a.n % n) return;
        if (!(dur > 0)) return;
        for (const u of areaAllies(b, e, e.x, e.y, BOOM_RADIUS)) b.applyStatus(u, 'stun', { duration: dur, source: e });
      },
    },
    { death(c, b, e) { if (c.reason === 'killed') summonAfterDeath(b, e, key, 1); } },
  ];
}

function kitDkmage(ab) {
  const ratio = tv(ab, 'epdamage.attack@ep_damage_ratio', 0);
  const jumps = Math.max(0, tv(ab, 'epdamage.attack@max_target', 4) - 1);
  const scale = tv(ab, 'epdamage.attack@chain.atk_scale', 0.85);
  const range = tv(ab, 'epdamage.attack@projectile_range', 1.6);
  const key = sv(ab.tS, 'deathrattle.enemy_key');
  const delay = tv(ab, 'deathrattle.delay', 1);
  return [
    ratio > 0 ? ep('apoptosis', ratio) : null,
    {
      dealt(c, b, e) {
        if (!(jumps > 0) || !c.target) return;
        let from = c.target;
        const seen = new Set([from.id]);
        let mul = scale;
        for (let i = 0; i < jumps && i < 8; i++) {
          const nxt = nearestAlly(b, e, from, range, seen);
          if (!nxt) break;
          seen.add(nxt.id);
          hurt(b, e, nxt, e.s.atk * mul, 'arts');
          if (ratio > 0) elem(b, e, nxt, 'apoptosis', e.s.atk * ratio * mul);
          mul *= scale;
          from = nxt;
        }
      },
    },
    { death(c, b, e) { if (c.reason === 'killed') summonAfterDeath(b, e, key, delay); } },
  ];
}

/** 饲育者: weighted death spawn. move_speed 2 is a move multiplier [ASSUMED]. */
function kitDsfull(ab) {
  const p1 = tv(ab, '0.prob1', 0.2);
  const p2 = tv(ab, '0.prob2', 0.5);
  const mul = tv(ab, '0.move_speed', 2);
  const cnt = tv(ab, '0.cnt', 1);
  return [{
    death(c, b, e) {
      if (c.reason !== 'killed') return;
      const r = b.rng();
      let key = sv(ab.tS, '0.enemy_3');
      if (r < p1) key = sv(ab.tS, '0.enemy_1');
      else if (r < p1 + p2) key = sv(ab.tS, '0.enemy_2');
      if (!key) return;
      const pos = [e.y, e.x];
      const route = remainingRoute(e);
      const kids = spawnChildren(b, e, key, cnt, { countInTotal: false, pos, route });
      for (let i = 0; i < kids.length; i++) {
        b.addBuff(kids[i], { key: 'reg:fast', persist: true, mods: { moveMul: mul } });
      }
    },
  }];
}

/** “左手”泰特斯: reborn() plus a silenced ATK cut on the highest-ATK ally. */
function kitLfkght(ab) {
  const sk = ab.sk.AtkDesWeaken;
  return [
    reborn({ dur: tv(ab, 'reborn.duration', 5) }),
    timed(sk, (b) => {
      let best = null;
      for (const u of b.allies()) {
        if (!u.alive) continue;
        if (!best || u.s.atk > best.s.atk || (u.s.atk === best.s.atk && u.id < best.id)) best = u;
      }
      if (!best) return;
      b.addBuff(best, { key: 'reg:weaken', duration: bb(sk, 'duration', 25), mods: { atkPct: bb(sk, 'atk', -0.5) } });
    }, { sil: true }),
  ];
}

function kitHarchn(ab) {
  const key = sv(ab.tS, 'deathrattle.enemy_key');
  const cnt = tv(ab, 'deathrattle.cnt', 4);
  const delay = tv(ab, 'deathrattle.delay', 0.2);
  const sk = ab.sk.SummonToken;
  return [
    {
      sil: true,
      death(c, b, e) { if (c.reason === 'killed') summonAfterDeath(b, e, key, delay, cnt); },
    },
    timed(sk, (b, e) => {
      const k = sv(sk.bs, 'enemy_key') || key;
      const n = bb(sk, 'cnt', 1);
      const pos = [e.y, e.x];
      const route = remainingRoute(e);
      spawnChildren(b, e, k, n, { countInTotal: false, pos, route });
    }, { sil: true }),
  ];
}

/** 寄生者: a nearby enemy's knock-down summons 大君之赐. Not its own death.
 *  被击倒 is reason 'killed' (a leak is not a knock-down). The summoned gift's own
 *  knock-down does not count: each parasite in range would replace one dead gift
 *  with another, and two of them grow without bound [ASSUMED]. */
function kitAcpara(ab) {
  const key = sv(ab.tS, 'Aura.enemy_key');
  const radius = tv(ab, 'Aura.range_radius', 1.5);
  return [{
    sil: true,
    spawn(b, e) { watchDeaths(b, e); },
    otherDeath(c, b, e) {
      const v = c.unit;
      if (c.reason !== 'killed' || !v || v === e || v.side !== 'enemy' || !key) return;
      if (v.defId === key) return;
      if (hypot(v.x - e.x, v.y - e.y) > radius + 1e-9) return;
      spawnChildren(b, e, key, 1, { countInTotal: false, pos: [v.y, v.x], route: remainingRoute(e), offspringKind: 'death' });
    },
  }];
}

// --- the other new draws --------------------------------------------------------------------------------

function phantasmDebuffSources(battle, source, target, key, duration) {
  const prior = target.findBuff(key)?.data?.invasionSources;
  if (!source.invasionBonds && !prior) return null;
  const sources = prior ?? new Map();
  for (const [seat, entry] of sources) if (entry.until <= battle.time + 1e-9) sources.delete(seat);
  if (source.invasionBonds) {
    const seat = source.invasionBonds.seat ?? source.sourcePlayerId;
    sources.set(seat, { source, until: battle.time + duration });
  }
  return sources;
}

function applyPhantasmDebuff(battle, source, target, buff) {
  const sources = phantasmDebuffSources(battle, source, target, buff.key, buff.duration);
  if (sources) buff.data = { invasionSources: sources };
  battle.addBuff(target, buff);
}

/** 假想敌：影役: stealth, and block count −1 on allies in range (one shared buff, so it does not stack). */
function kitAcblk(ab) {
  const radius = tv(ab, 'Aura.range_radius', 1.8);
  const block = tv(ab, 'Aura.block_cnt', -1);
  return [
    stealth(),
    {
      tick(b, e) {
        for (const u of auraAllies(b, e, e.x, e.y, radius)) {
          if (u.kind !== 'op') continue;
          applyPhantasmDebuff(b, e, u, { key: 'reg:blockdown', duration: 0.35, mods: { blockCnt: block }, visible: true });
        }
      },
    },
  ];
}

/** 假想敌：镜眼: refraction, and a silenced ASPD cut on the source of arts damage. */
function kitAcrefm(ab) {
  const res = tv(ab, 'refracting.magic_resistance', 70);
  const aspd = tv(ab, 'refracting.attack_speed', -50);
  const dur = tv(ab, 'refracting.duration', 3);
  return [
    refraction(res),
    {
      sil: true,
      taken(c, b, e) {
        if (!c.dmg || c.dmg.type !== 'arts' || !c.source || !c.source.alive) return;
        if (!(dur > 0)) return;
        const key = 'reg:refslow';
        const sources = phantasmDebuffSources(b, e, c.source, key, dur);
        b.applyStrongest(c.source, key, { source: e, duration: dur, value: aspd, mods: value => ({ aspd: value }) });
        const buff = sources && c.source.findBuff(key);
        if (buff) buff.data.invasionSources = sources;
      },
    },
  ];
}

/** 假想敌：镜波: refraction, and on death the lowest-RES enemy nearby gains RES. */
function kitAcrefd(ab) {
  const res = tv(ab, 'refracting.magic_resistance', 70);
  const radius = tv(ab, 'refracting.range_radius', 1.2);
  const bonus = tv(ab, 'refracting.acrefd[magic-resistance].magic_resistance', 10);
  return [
    refraction(res),
    {
      sil: true,
      death(c, b, e) {
        if (c.reason !== 'killed' || !(bonus > 0)) return;
        let best = null;
        for (const o of b.enemiesInRadius(e.x, e.y, radius)) {
          if (!o.alive || o === e) continue;
          if (!best || o.s.res < best.s.res || (o.s.res === best.s.res && o.id < best.id)) best = o;
        }
        if (best) b.addBuff(best, { key: 'reg:res', persist: true, mods: { resFlat: bonus } });
      },
    },
  ];
}

/** “模拟宝藏”: a hostage when the enemy record itself is spawned. It does not attack (applyWay NONE)
 *  and does not move. The command deploys an ally device instead (content/bands/commands.js): enemy
 *  contact and the survival coin live there, so this kit is not the payoff. */
function kitAchest() {
  return [{
    spawn(b, e) {
      e.profile.noAttack = true;
      b.addBuff(e, { key: 'reg:hostage', persist: true, flags: { noMove: true } });
    },
  }];
}

const same = (kit) => kit;

const originiumPollution = new WeakMap();
const POLLUTION_PULSE = 0.25;

function polluteDeathTile(battle, enemy) {
  const row = Math.round(enemy.y), col = Math.round(enemy.x);
  if (!battle.grid.inRect(row, col)) return;
  let tiles = originiumPollution.get(battle);
  if (!tiles) originiumPollution.set(battle, tiles = new Set());
  const key = row * COLS + col;
  if (tiles.has(key)) return;
  tiles.add(key);
  const life = Math.min(battle.timeLimit, MAX_BATTLE_TIME) - battle.time;
  battle.fx('zone', { x: col, y: row, r: 0.5, dur: life, kind: 'originiumPollution' });
  if (battle.hasHook('enemyZoneSpawn')) {
    battle.emit('enemyZoneSpawn', { source: enemy, x: col, y: row, radius: 0.5, duration: life, kind: 'originiumPollution' });
  }

  // [ASSUMED] The death tile lasts for this battle and deals 50 true damage per second, with 20% natural SP recovery.
  let nextDamage = battle.time + 1;
  battle.every(POLLUTION_PULSE, () => {
    const damageDue = battle.time + 1e-9 >= nextDamage;
    if (damageDue) nextDamage += 1;
    for (const unit of battle.alliesInRadius(col, row, 0.75)) {
      if (Math.round(unit.x) !== col || Math.round(unit.y) !== row) continue;
      auraBuff(battle, unit, 'ab:originium', POLLUTION_PULSE, { spRecoveryMul: 0.2 }, null, true);
      if (damageDue) battle.dealDamage(null, unit, { ...periodicDamage(50), tags: ['terrain', 'pollution'] });
    }
  });
}

function kitLrboom(ab) {
  return [
    deathBoom({ scale: tv(ab, 'Boom.atk_scale', 0) }),
    { sil: true, death(c, b, e) { if (c.reason === 'killed') polluteDeathTile(b, e); } },
  ];
}

export const REGULATION_KITS = Object.freeze({
  enemy_1424_lrboom: kitLrboom,
  enemy_1406_chghmr: kitChghmr,
  enemy_1373_ltnhor: (ab) => kitWitchkingAttack(ab),
  enemy_1373_ltnhor_2: (ab) => kitWitchkingAttack(ab),
  enemy_1375_ltnclr: kitLtnclr,
  enemy_1375_ltnclr_2: same(kitLtnclr),
  enemy_1376_ltndru: (ab) => kitWitchkingAttack(ab, 'drum'),
  enemy_1376_ltndru_2: (ab) => kitWitchkingAttack(ab, 'drum'),
  enemy_1388_wingnt: kitWingnt,
  enemy_1388_wingnt_2: same(kitWingnt),
  enemy_1191_krgrg: kitKrgrg,
  enemy_1191_krgrg_2: same(kitKrgrg),
  enemy_1213_mtrsnp: kitPathfinderMagazine,
  enemy_1216_cansld: kitPathfinderMagazine,
  enemy_1219_mtrbty: kitMtrbty,
  enemy_1409_bdguad_2: kitBdguad,
  enemy_1431_lrmzrd: kitLrmzrd,
  enemy_1431_lrmzrd_2: same(kitLrmzrd),
  enemy_9040_accrit: kitAccrit,
  enemy_1226_dklord: kitDklord,
  enemy_1226_dklord_2: same(kitDklord),
  enemy_1362_dfat: kitDfat,
  enemy_1362_dfat_2: same(kitDfat),
  enemy_1225_dkmage: kitDkmage,
  enemy_1225_dkmage_2: same(kitDkmage),
  enemy_1437_dsfull: kitDsfull,
  enemy_1437_dsfull_2: same(kitDsfull),
  enemy_1104_lfkght_3: kitLfkght,
  enemy_1133_harchn: kitHarchn,
  enemy_1133_harchn_2: same(kitHarchn),
  enemy_9030_acpara: kitAcpara,
  enemy_9034_acblk: kitAcblk,
  enemy_9039_acrefm: kitAcrefm,
  enemy_9031_acrefd: kitAcrefd,
  enemy_9038_achest: kitAchest,
});
