const COCOON_LIMIT = 6;
const COCOON_DURATION = 12;
const VINE_KEY = 'invasion:vineRelay';
const VINE_DURATION = 5;
const VINE_LIMIT = 2;
const STATE = new WeakMap();

function stateOf(battle) {
  let state = STATE.get(battle);
  if (!state) {
    state = {};
    STATE.set(battle, state);
  }
  return state;
}

const inLane = (battle, enemy) => battle.kind === 'normal' && !!enemy?.sourcePlayerId;
const isOperator = target => target?.kind === 'op' && target.alive && target.deployed;

export function isHighGroundOperator(battle, target) {
  return isOperator(target) && battle.grid.tile(target.tileR, target.tileC).height === 'HIGH';
}

export function usesInvasionHighGround(battle, enemy, attackNumber) {
  return inLane(battle, enemy) && enemy.invasion?.kind === 'highGround' && attackNumber <= 2;
}

export function invasionHighGroundMultiplier(battle, target, empowered) {
  return empowered && isHighGroundOperator(battle, target) ? 1.2 : 1;
}

export function applyInvasionSpawn(battle, enemy) {
  if (!inLane(battle, enemy) || !enemy.alive) return;
  const vines = STATE.get(battle)?.vines?.get(enemy.sourcePlayerId);
  if (vines) updateVineBuff(battle, enemy, vines.zones);
  switch (enemy.invasion?.kind) {
    case 'heavyCover':
      battle.addBuff(enemy, { key: 'invasion:heavyCover', duration: 8, shield: enemy.s.maxHp * 0.2, visible: true });
      battle.fx('shield', { x: enemy.x, y: enemy.y, id: enemy.id });
      break;
    case 'doubleGate':
      battle.addBuff(enemy, { key: 'invasion:doubleGate', duration: 6, mods: { moveMul: 1.2 }, visible: true });
      break;
    case 'shadowRaid':
      battle.addBuff(enemy, { key: 'invasion:shadowRaid', duration: 5, flags: { stealth: true }, visible: true });
      installBlockEffects(battle);
      break;
    case 'ram':
    case 'coldTide':
    case 'slipstream':
      installBlockEffects(battle);
      break;
    case 'armorPiercing':
    case 'saltErosion':
      installFirstHitEffects(battle);
      break;
  }
}

function installBlockEffects(battle) {
  const state = stateOf(battle);
  if (state.blocked) return;
  const blocked = state.blocked = new WeakSet();
  const coldTides = new Map();
  battle.on('blocked', ({ enemy, blocker }) => {
    if (!inLane(battle, enemy) || !enemy.invasion || blocked.has(enemy)) return;
    switch (enemy.invasion.kind) {
      case 'ram':
        blocked.add(enemy);
        battle.applyStatus(blocker, 'stun', { source: enemy, duration: 1.2 });
        break;
      case 'slipstream':
        blocked.add(enemy);
        battle.applyStatus(enemy, 'unblockable', { duration: 2 });
        break;
      case 'shadowRaid':
        blocked.add(enemy);
        battle.removeBuff(enemy, 'invasion:shadowRaid');
        break;
      case 'coldTide':
        blocked.add(enemy);
        applyColdTide(battle, enemy, blocker, coldTides);
        break;
    }
  });
}

function applyColdTide(battle, enemy, blocker, counters) {
  const { sourcePlayerId, invasion: { gate } } = enemy;
  let gates = counters.get(sourcePlayerId);
  if (!gates) counters.set(sourcePlayerId, gates = { upper: 0, lower: 0, fired: false });
  if (gates.fired || (gate !== 'upper' && gate !== 'lower') || ++gates[gate] < 3) return;
  gates.fired = true;
  battle.fx('tide', { x: blocker.tileC, y: blocker.tileR, r: 1 });
  for (const ally of battle.allies()) {
    // [ASSUMED] Adjacent tiles share an edge with the blocker’s tile.
    const distance = Math.abs(ally.tileR - blocker.tileR) + Math.abs(ally.tileC - blocker.tileC);
    if (ally.kind !== 'op' || distance > 1) continue;
    battle.addBuff(ally, { key: 'invasion:coldTide', duration: 5, mods: { aspd: -20 }, visible: true });
  }
}

function installFirstHitEffects(battle) {
  const state = stateOf(battle);
  state.firstHitHook ??= battle.on('damageApplied', ({ source, target }) => applyInvasionFirstHit(battle, source, target));
}

/** A source-less shell may name its firer for the strategy while settling damage without a source. */
export function applyInvasionFirstHit(battle, enemy, target, deploySeq = target?.deploySeq) {
  if (!inLane(battle, enemy) || target?.kind !== 'op' || target.side !== 'ally') return;
  const kind = enemy.invasion?.kind;
  if (kind !== 'armorPiercing' && kind !== 'saltErosion') return;
  const state = stateOf(battle);
  const firstHits = state.firstHits ??= new WeakSet();
  if (firstHits.has(enemy)) return;
  firstHits.add(enemy);
  if (!isOperator(target) || target.hp <= 0 || target.deploySeq !== deploySeq) return;
  if (kind === 'armorPiercing') {
    const pierced = state.pierced ??= new WeakSet();
    if (pierced.has(target)) return;
    pierced.add(target);
    battle.addBuff(target, { key: 'invasion:armorPiercing', duration: 5, mods: { defMul: 0.85 }, visible: true });
  } else {
    battle.addBuff(target, { key: 'invasion:saltErosion', duration: 6, mods: { healingTakenMul: 0.65 }, visible: true });
  }
}

const vineTile = (enemy) => `${Math.round(enemy.y)},${Math.round(enemy.x)}`;

function updateVineBuff(battle, enemy, zones) {
  const inside = zones.has(vineTile(enemy));
  const buff = enemy.findBuff(VINE_KEY);
  if (inside && !buff) battle.addBuff(enemy, { key: VINE_KEY, mods: { atkPct: 0.2 }, visible: true });
  else if (!inside && buff) battle.removeBuff(enemy, buff);
}

function updateVineAllies(battle, vines) {
  for (const enemy of battle.enemies) {
    const entry = enemy.alive && vines.get(enemy.sourcePlayerId);
    if (entry) updateVineBuff(battle, enemy, entry.zones);
  }
}

/** Run after a blocked creature is actually knocked out, with the block already released. */
export function applyInvasionBlockedDeath(battle, enemy) {
  if (!inLane(battle, enemy) || enemy.invasion?.kind !== 'vineRelay' || enemy.isFlying) return;
  const state = stateOf(battle);
  if (!state.vines) {
    const vines = state.vines = new Map();
    battle.on('tick', () => updateVineAllies(battle, vines));
  }
  let entry = state.vines.get(enemy.sourcePlayerId);
  if (!entry) state.vines.set(enemy.sourcePlayerId, entry = { used: 0, zones: new Map() });
  if (entry.used >= VINE_LIMIT) return;
  entry.used++;
  const tile = vineTile(enemy);
  const zone = { x: Math.round(enemy.x), y: Math.round(enemy.y) };
  entry.zones.set(tile, zone);
  battle.fx('zone', { ...zone, r: 0.5, dur: VINE_DURATION, kind: 'vineRelay', key: `vine:${enemy.sourcePlayerId}:${tile}` });
  updateVineAllies(battle, state.vines);
  battle.after(VINE_DURATION, () => {
    if (entry.zones.get(tile) !== zone) return;
    entry.zones.delete(tile);
    updateVineAllies(battle, state.vines);
  });
}

/** Apply the leader's spawn effect after the child has its own stats and enemy abilities. */
export function applyInvasionOffspring(battle, parent, child) {
  if (!inLane(battle, parent) || parent.invasion?.kind !== 'cocoon' || !child.alive) return;
  const uses = stateOf(battle).cocoons ??= new Map();
  const count = uses.get(parent.sourcePlayerId) ?? 0;
  if (count >= COCOON_LIMIT) return;
  uses.set(parent.sourcePlayerId, count + 1);
  battle.addBuff(child, {
    key: 'invasion:cocoon', duration: COCOON_DURATION, shield: child.s.maxHp * 0.5,
    mods: { moveMul: 1.5 }, visible: true,
  });
  battle.fx('shield', { x: child.x, y: child.y, id: child.id });
}
