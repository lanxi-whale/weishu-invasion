import { roundHalfEven } from '../detmath.js';
import { canTargetAlly } from '../targeting.js';

const BOND = Object.freeze({
  snow: 'mon_minor_snow',
  special: 'mon_minor_special',
  carnival: 'mon_minor_carnival',
  sankta: 'mon_minor_sankta',
  theater: 'mon_minor_theater',
  prisoner: 'mon_minor_prisoner',
  arc: 'mon_minor_arc',
  visitor: 'mon_minor_visitor',
  rhine: 'mon_minor_rhine',
  knight: 'mon_minor_knight',
  water: 'mon_minor_water',
  pathfinder: 'mon_minor_pathfinder',
});
const BALLOON = 'enemy_10040_cnvbln';
const FRONTLINER = 'enemy_1406_chghmr';
const CROSS = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
const fields = new WeakMap();
const present = unit => unit.alive && unit.deployed && !unit.hidden && unit.hp > 0;
const enemyKey = enemy => enemy.def.raw?.effectRef ?? enemy.defId;
const row = unit => unit.side === 'ally' ? unit.tileR : roundHalfEven(unit.y);
const col = unit => unit.side === 'ally' ? unit.tileC : roundHalfEven(unit.x);
const inside = (battle, field, unit) => field && battle.time + 1e-9 < field.until
  && Math.abs(row(unit) - field.row) + Math.abs(col(unit) - field.col) <= 1;
const nearby = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= 4 + 1e-9;
};

export function inInvasionCamera(battle, enemy) {
  const areas = fields.get(battle);
  return !!(areas && areas.tier(enemy, BOND.theater) && inside(battle, areas.cameras.get(areas.seat(enemy)), enemy));
}

function createField(battle, target, kind, duration, tier) {
  const r = row(target);
  const c = col(target);
  for (const [dr, dc] of CROSS) {
    if (!battle.grid.inRect(r + dr, c + dc)) continue;
    battle.fx('zone', { x: c + dc, y: r + dr, r: 0.45, dur: duration, kind });
  }
  return { row: r, col: c, until: battle.time + duration, tier };
}

function buff(battle, unit, key, duration, mods, source = unit) {
  battle.addBuff(unit, { key, duration, mods, source, visible: true });
}

function installOffense(battle, { tier, seat, sameSeat }, cameras) {
  const snowHits = new WeakMap();
  const frontliners = new WeakMap();
  function camera(enemy, defender) {
    const level = tier(enemy, BOND.theater);
    const id = seat(enemy);
    if (!level || defender.side !== 'ally' || cameras.has(id)) return;
    cameras.set(id, createField(battle, defender, 'invasionCamera', level === 2 ? 8 : 5, level));
  }

  battle.on('blocked', ({ enemy, blocker }) => {
    camera(enemy, blocker);
    if (tier(enemy, BOND.pathfinder) && enemyKey(enemy) === FRONTLINER && !frontliners.has(enemy)) frontliners.set(enemy, true);
  });

  battle.on('damageOutput', ctx => {
    const { source, target, dmg } = ctx;
    if (target.side !== 'ally' || !dmg.isAttack || dmg.isSkill || !frontliners.get(source)) return;
    ctx.amount *= tier(source, BOND.pathfinder) === 2 ? 1.25 : 1.15;
  });

  battle.on('damageApplied', ({ source, credit, target, dmg }) => {
    const enemy = source ?? credit;
    if (!enemy || enemy.side !== 'enemy' || target.side !== 'ally') return;
    camera(enemy, target);
    if (dmg.isAttack && !dmg.isSkill && frontliners.get(enemy)) frontliners.set(enemy, false);
    if (target.hp <= 0) return;
    const species = enemy.invasionBonds?.species;
    if (species && tier(enemy, BOND.snow)) {
      let seen = snowHits.get(target);
      if (!seen) snowHits.set(target, seen = new Set());
      const key = JSON.stringify([seat(enemy), species]);
      if (!seen.has(key)) {
        seen.add(key);
        battle.applyStatus(target, 'cold', { source: enemy, duration: 3 });
      }
    }
  });

  battle.on('damaged', ({ source, credit, target, dmg }) => {
    if (target.side !== 'ally' || target.hp <= 0 || !dmg?.isAttack || dmg.isSkill || dmg.type === 'element') return;
    const enemy = source ?? credit;
    const water = tier(enemy, BOND.water);
    if (water) {
      battle.dealElementDamage({ source: enemy, target, element: 'erosion', amount: enemy.s.atk * (water === 2 ? 0.15 : 0.08) });
    }
  });

  battle.on('elementHit', ({ source, credit, target, dmg }) => {
    const enemy = source ?? credit;
    if (target.side !== 'ally' || dmg.element !== 'neural' || !tier(enemy, BOND.theater)) return;
    const field = cameras.get(seat(enemy));
    if (inside(battle, field, target)) dmg.mul *= field.tier === 2 ? 1.25 : 1.15;
  });

  battle.on('elementBurst', ({ source, credit, target, element }) => {
    const enemy = source ?? credit;
    if (element !== 'erosion' || target.side !== 'ally' || tier(enemy, BOND.water) !== 2) return;
    for (const member of battle.aliveEnemies()) {
      if (present(member) && sameSeat(enemy, member) && tier(member, BOND.water) && nearby(member, target)) {
        buff(battle, member, 'invasion:waterHaste', 4, { moveMul: 1.2 }, enemy);
      }
    }
  });
}

function installDefense(battle, { tier }) {
  const spedUp = new WeakSet();
  const adapted = new WeakSet();
  const arcs = new WeakMap();
  const reducedHits = new WeakMap();
  battle.on('hpChanged', ({ target, delta }) => {
    const level = tier(target, BOND.special);
    if (!level || !(delta < 0) || target.hp <= 0 || target.hpRatio >= 0.5 || spedUp.has(target)) return;
    spedUp.add(target);
    buff(battle, target, 'invasion:specialSprint', 4, { moveMul: level === 2 ? 1.35 : 1.2 });
  });

  battle.on('damageApplied', ({ target, dmg, hpRemoved }) => {
    const level = tier(target, BOND.rhine);
    if (!level || !(hpRemoved > 0) || target.hp <= 0 || adapted.has(target)) return;
    const key = dmg.type === 'phys' ? 'physTakenMul' : dmg.type === 'arts' ? 'artsTakenMul' : null;
    if (!key) return;
    adapted.add(target);
    buff(battle, target, 'invasion:rhineAdaptation', level === 2 ? 8 : 6, { [key]: level === 2 ? 0.65 : 0.8 });
  });

  battle.on('damageApplying', ctx => {
    const { target, dmg, amount } = ctx;
    if (!tier(target, BOND.arc) || !(amount > 0)) return;
    let guard = arcs.get(target);
    if (!guard) arcs.set(target, guard = { left: 3, protectedAt: -Infinity });
    if (guard.left > 0) {
      guard.left--;
      guard.protectedAt = battle.time;
      reducedHits.set(dmg, guard);
      ctx.amount *= 0.8;
    } else {
      guard.protectedAt = -Infinity;
    }
  }, { priority: -1000 });

  battle.on('dodge', ({ dmg, cancelled }) => {
    const guard = cancelled && reducedHits.get(dmg);
    if (!guard) return;
    reducedHits.delete(dmg);
    guard.left++;
  });

  battle.on('displaceDistance', ctx => {
    if (!tier(ctx.enemy, BOND.arc)) return;
    const guard = arcs.get(ctx.enemy);
    // A push or pull in the same frame can happen before or after its damage.
    if (!guard || guard.left > 0 || guard.protectedAt === battle.time) ctx.distance *= 0.75;
  });
}

function installNativeEvents(battle, { tier }) {
  const rallied = new WeakSet();
  const fearBuffs = new WeakSet();
  const reloaded = new WeakSet();
  function rally(enemy) {
    const level = tier(enemy, BOND.sankta);
    if (!level || !present(enemy) || rallied.has(enemy)) return;
    rallied.add(enemy);
    buff(battle, enemy, 'invasion:sanktaRally', 4, level === 2 ? { moveMul: 1.25, aspd: 25 } : { moveMul: 1.15, aspd: 15 });
  }

  battle.on('statusApplied', ({ target, status }) => {
    if (status !== 'fear' || !tier(target, BOND.sankta) || rallied.has(target)) return;
    const fear = target.findBuff('fear');
    if (!fear || fearBuffs.has(fear)) return;
    fearBuffs.add(fear);
    function rallyAfter(previous) {
      return ctx => {
        previous?.(ctx);
        if (!target.s.flags.fear) rally(target);
      };
    }
    fear.onRemove = rallyAfter(fear.onRemove);
    fear.onExpire = rallyAfter(fear.onExpire);
  });

  battle.on('enemyAmmoUsed', ({ enemy, left, refill }) => {
    rally(enemy);
    const level = tier(enemy, BOND.pathfinder);
    if (!level || left !== 0 || reloaded.has(enemy) || !refill) return;
    reloaded.add(enemy);
    battle.after(level === 2 ? 2 : 4, () => {
      if (enemy.alive && !enemy.removed) refill();
    }, { owner: enemy });
  });

  battle.on('prisonerConfinement', ctx => {
    ctx.attacks = Math.max(1, ctx.attacks - tier(ctx.enemy, BOND.prisoner));
  });
  battle.on('prisonerLiberated', ({ enemy }) => {
    if (tier(enemy, BOND.prisoner) === 2) {
      battle.heal({ source: enemy, target: enemy, amount: (enemy.s.maxHp - enemy.hp) * 0.25 });
    }
  });
}

function installGroupEffects(battle, { tier, seat, sameSeat }, ice) {
  const rallied = new Set();
  const carnivalCooldown = new Map();
  const revealed = new WeakSet();

  function celebrate(enemy) {
    const id = seat(enemy);
    if (id == null || (carnivalCooldown.get(id) ?? -Infinity) > battle.time + 1e-9) return;
    carnivalCooldown.set(id, battle.time + 8);
    for (const member of battle.aliveEnemies()) {
      if (present(member) && sameSeat(enemy, member) && nearby(member, enemy)) {
        buff(battle, member, 'invasion:carnivalCheer', 4, { aspd: 20 }, enemy);
      }
    }
  }

  function updateIce(enemy) {
    const area = ice.get(seat(enemy));
    const key = 'invasion:visitorIce';
    if (tier(enemy, BOND.visitor) && present(enemy) && inside(battle, area, enemy)) {
      if (!enemy.findBuff(key)) {
        const mods = area.tier === 2 ? { defPct: 0.25, resFlat: 8 } : { defPct: 0.15 };
        buff(battle, enemy, key, area.until - battle.time, mods);
      }
    } else if (enemy.findBuff(key)) {
      battle.removeBuff(enemy, key);
    }
  }

  battle.on('enemyStealthChanged', ({ enemy, stealthed }) => {
    if (stealthed || !present(enemy) || !tier(enemy, BOND.carnival) || revealed.has(enemy)) return;
    revealed.add(enemy);
    celebrate(enemy);
  });

  // A native rebirth can stop the kill event while still counting as a knockout.
  battle.on('kill', ({ victim: unit }) => {
    const id = seat(unit);
    if (id == null) return;
    if (tier(unit, BOND.carnival) && enemyKey(unit) === BALLOON) celebrate(unit);
    const visitor = tier(unit, BOND.visitor);
    if (visitor && !ice.has(id)) {
      const duration = visitor === 2 ? 6 : 4;
      ice.set(id, createField(battle, unit, 'invasionIce', duration, visitor));
      for (const enemy of battle.aliveEnemies()) if (sameSeat(enemy, unit)) updateIce(enemy);
      battle.after(duration, () => {
        for (const enemy of battle.aliveEnemies()) if (sameSeat(enemy, unit)) updateIce(enemy);
      });
    }
    if (tier(unit, BOND.knight) && !rallied.has(id)) {
      rallied.add(id);
      for (const member of battle.aliveEnemies()) {
        if (present(member) && sameSeat(unit, member) && tier(member, BOND.knight)) {
          battle.heal({ source: unit, target: member, amount: member.s.maxHp * 0.15 });
          buff(battle, member, 'invasion:knightResolve', 4, null, unit);
        }
      }
    }
  }, { priority: 1100 });

  battle.on('enemyAttackStart', ({ enemy, targets }) => {
    if (targets.length < 2 || !enemy.findBuff('invasion:knightResolve')) return;
    targets.sort((a, b) => {
      const aSelectable = canTargetAlly(enemy, a, true);
      const bSelectable = canTargetAlly(enemy, b, true);
      return Number(bSelectable) - Number(aSelectable) || (aSelectable ? b.s.atk - a.s.atk : 0);
    });
  });

  battle.on('enemySpawn', ({ enemy }) => { if (ice.size) updateIce(enemy); });
  battle.on('hit', ({ target }) => { if (ice.size && target.side === 'enemy') updateIce(target); }, { priority: 300 });
  battle.on('tick', () => {
    if (!ice.size) return;
    for (const enemy of battle.aliveEnemies()) updateIce(enemy);
  });
}

export function installInvasionMinorBonds(battle, api) {
  if (fields.has(battle)) return;
  const cameras = new Map();
  const ice = new Map();
  fields.set(battle, { tier: api.tier, seat: api.seat, cameras });
  installOffense(battle, api, cameras);
  installDefense(battle, api);
  installNativeEvents(battle, api);
  installGroupEffects(battle, api, ice);
}
