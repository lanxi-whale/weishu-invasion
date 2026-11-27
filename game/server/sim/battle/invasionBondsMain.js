import { areaSelectable, tileKeyOf } from '../targeting.js';
import { COLS } from '../constants.js';
import { isHpLoss } from '../attack.js';
import { spawnChildren } from '../content/enemies/helpers.js';

const YAN = 'mon_main_yan';
const SEABORN = 'mon_main_seaborn';
const COURT = 'mon_main_court';
const DECAY = 'mon_main_decay';
const REUNION = 'mon_main_reunion';
const DRONE = 'mon_main_drone';
const WITCHKING = 'mon_main_witchking';
const PHANTASM = 'mon_main_phantasm';
const INFECTION = 'mon_main_infection';
const ABYSS = 'mon_main_abyss';

const SEABORN_NEURAL = 0.10;
const SEABORN_SPLIT = 'seabornSplit';
const DRONE_SHIELD = 'invasionBond:droneShield';
const WITCHKING_VARIATION = 'invasionBond:witchkingVariation';
const DEATH_ARTIFACTS = new Set([
  'enemy_1196_msfyin', 'enemy_1198_msfshu', 'enemy_1200_msfjin',
  'enemy_1204_msfhu', 'enemy_1208_msfji', 'enemy_1210_msfden',
]);
const DECAY_CONSTRUCTS = new Set(['enemy_1220_dzoms', 'enemy_1221_dzomg']);
const VARIATION_ROLES = new Map([
  ['enemy_1373_ltnhor', 'enthu'], ['enemy_1375_ltnclr', 'depressed'], ['enemy_1376_ltndru', 'enthu'],
]);
const EPSILON = 1e-9;

const nativeKind = enemy => (enemy?.def?.raw?.effectRef ?? enemy?.defId ?? '').replace(/_2$/, '');
const memberSpecies = enemy => enemy?.invasionBonds?.species;
const onField = unit => unit?.alive && unit.hp > 0 && unit.deployed && !unit.hidden;
const defender = unit => unit?.side === 'ally' && unit.kind !== 'device';
const unitKey = (battle, unit) => JSON.stringify([unit.ownerId, unit.uid ?? ['runtime', battle.fieldId ?? battle.kind, unit.id]]);
const numberAt = (tier, low, high) => tier === 2 ? high : low;
const elapsed = (now, due) => now + EPSILON >= due;

function inRadius(unit, x, y, radius) {
  const dx = unit.x - x;
  const dy = unit.y - y;
  return dx * dx + dy * dy <= radius * radius + EPSILON;
}

function formationBuff(battle, enemy, key, value, mods) {
  const buff = enemy.findBuff(key);
  if (buff?.data === value || (!buff && !value)) return;
  if (value) battle.addBuff(enemy, { key, mods, data: value, visible: true });
  else battle.removeBuff(enemy, buff);
}

function updateFormation(battle, api, formation) {
  const members = [...formation];
  for (const enemy of members) {
    const reunion = api.tier(enemy, REUNION);
    const abyss = api.tier(enemy, ABYSS);
    if (reunion) {
      const melee = enemy.def.applyWay === 'MELEE';
      const counterpart = melee ? 'RANGED' : 'MELEE';
      const paired = onField(enemy) && (melee || enemy.def.applyWay === 'RANGED')
        && members.some(other => other !== enemy && onField(other) && api.sameSeat(enemy, other)
          && api.tier(other, REUNION) && other.def.applyWay === counterpart && inRadius(other, enemy.x, enemy.y, 2));
      const bonus = paired ? numberAt(reunion, 0.12, 0.2) : 0;
      formationBuff(battle, enemy, 'invasionBond:reunion', bonus, melee ? { dmgTakenMul: 1 - bonus } : { atkPct: bonus });
    }
    if (abyss) {
      const species = new Set();
      if (onField(enemy)) for (const other of formation) {
        const id = memberSpecies(other);
        if (!id || id === memberSpecies(enemy) || !onField(other) || !api.sameSeat(enemy, other)
          || !api.tier(other, ABYSS) || !inRadius(other, enemy.x, enemy.y, 1)) continue;
        species.add(id);
        if (species.size >= 2) break;
      }
      const bonus = species.size * numberAt(abyss, 0.12, 0.2);
      formationBuff(battle, enemy, 'invasionBond:abyss', bonus, { defPct: bonus });
    }
  }
}

function birthArtifact(battle, api, enemy, parent, offspringKind) {
  const tier = api.tier(parent, YAN);
  if (offspringKind !== 'death' || !tier || !DEATH_ARTIFACTS.has(nativeKind(enemy))) return;
  if (!api.take(parent, YAN, numberAt(tier, 6, 10))) return;
  battle.addBuff(enemy, {
    key: 'invasionBond:yanArtifact', duration: numberAt(tier, 6, 8), visible: true,
    mods: { moveMul: numberAt(tier, 1.3, 1.45) },
  });
  for (const other of battle.enemiesInRadius(enemy.x, enemy.y, 2, true)) {
    if (other === enemy || other.invasionBonds?.offspring || !onField(other) || !api.sameSeat(parent, other) || !api.tier(other, YAN)) continue;
    battle.addBuff(other, {
      key: 'invasionBond:yanDamage', duration: numberAt(tier, 4, 6), visible: true,
      mods: { dmgDealtMul: numberAt(tier, 1.15, 1.25) },
    });
  }
}

function markCourtTarget(battle, api, source, target) {
  if (!api.tier(source, COURT) || !api.take(source, COURT + ':' + unitKey(battle, target))) return;
  if (!onField(target)) return;
  battle.addBuff(target, { key: COURT + ':' + api.seat(source), duration: 5, source, visible: true });
}

function applyDroneShield(battle, api, enemy) {
  const tier = api.tier(enemy, DRONE);
  const gate = enemy.invasionBonds?.gate;
  if (!tier || (gate !== 'upper' && gate !== 'lower') || !api.take(enemy, DRONE + ':' + gate)) return;
  battle.addBuff(enemy, {
    key: DRONE_SHIELD, duration: 6, shield: enemy.s.maxHp * numberAt(tier, 0.2, 0.35), visible: true,
  });
  battle.fx('shield', { x: enemy.x, y: enemy.y, id: enemy.id });
}

function prioritizeShieldedDrones(battle, api, attacker, candidates) {
  if (attacker.side !== 'ally' || attacker.kind === 'device' || battle.effectiveProfile(attacker)?.attack !== 'ranged') return;
  const slots = [];
  const shielded = [];
  const otherDrones = [];
  for (let i = 0; i < candidates.length; i++) {
    const enemy = candidates[i];
    if (!enemy.invasionBonds?.members?.includes(DRONE) && !api.tier(enemy, DRONE)) continue;
    slots.push(i);
    const buff = enemy.findBuff(DRONE_SHIELD);
    (buff?.shield > 0 ? shielded : otherDrones).push(enemy);
  }
  if (!shielded.length || !otherDrones.length) return;
  const order = shielded.concat(otherDrones);
  for (let i = 0; i < slots.length; i++) candidates[slots[i]] = order[i];
}

function applyVariation(battle, enemy, variation) {
  const role = nativeKind(enemy);
  const mode = VARIATION_ROLES.get(role);
  if (!mode) return;
  const stats = enemy.def.raw?.talents?.bb;
  if (!stats) return;
  const prefix = 'switchMode.enemy_act29side[buff_' + mode + '].';
  const restore = role === 'enemy_1376_ltndru' ? extendDrumRange(enemy) : undefined;
  battle.addBuff(enemy, {
    key: WITCHKING_VARIATION, duration: variation.until - battle.time, visible: true,
    data: { mode, stunned: variation.stunned, until: variation.until },
    onExpire: restore, onRemove: restore,
    mods: {
      aspd: stats[prefix + 'attack_speed'] ?? 0,
      atkPct: stats[prefix + 'atk'] ?? 0,
      moveMul: stats[prefix + 'move_speed'] ?? 1,
      defPct: stats[prefix + 'def'] ?? 0,
    },
  });
}

// [ASSUMED] The drum record names an alternate attack without a range value. Use a 1.5-tile range for the variation.
function extendDrumRange(enemy) {
  const radius = enemy.base.rangeRadius;
  const melee = enemy.profile.melee;
  enemy.base.rangeRadius = Math.max(radius, 1.5);
  enemy.profile.melee = false;
  return () => {
    enemy.base.rangeRadius = radius;
    enemy.profile.melee = melee;
  };
}

export function witchkingVariation(enemy) {
  return enemy.findBuff(WITCHKING_VARIATION)?.data ?? null;
}

export function tryWitchkingStun(battle, enemy, target, duration) {
  const variation = witchkingVariation(enemy);
  const key = unitKey(battle, target);
  if (variation?.stunned.has(key)) return;
  if (battle.applyStatus(target, 'stun', { duration, source: enemy }) && variation) variation.stunned.add(key);
}

function startVariation(battle, api, enemy, music) {
  const tier = api.tier(enemy, WITCHKING);
  if (!tier) return;
  const seat = api.seat(enemy);
  const previous = music.get(seat);
  if (previous) {
    if (previous.active && !elapsed(battle.time, previous.active.until)) applyVariation(battle, enemy, previous.active);
    return;
  }
  const timeline = { active: null };
  music.set(seat, timeline);
  const play = () => {
    const musicians = battle.enemies.filter(other =>
      onField(other) && api.sameSeat(enemy, other) && api.tier(other, WITCHKING));
    if (musicians.length === 0 || !api.take(enemy, WITCHKING, tier)) return;
    timeline.active = { until: battle.time + numberAt(tier, 5, 7), stunned: new Set() };
    for (const musician of musicians) applyVariation(battle, musician, timeline.active);
  };
  battle.after(4, play);
  if (tier === 2) battle.after(16, play);
}

function tileDistance(a, b) {
  if (a < 0 || b < 0) return Infinity;
  return Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS)) + Math.abs(a % COLS - b % COLS);
}

function addDecayGauge(battle, api, zones, source, target, dmg) {
  const tier = api.tier(source, DECAY);
  if (!tier || !dmg.isAttack || dmg.isSkill || !onField(source)) return;
  const tile = tileKeyOf(source);
  if (tile < 0) return;
  const row = Math.floor(tile / COLS);
  const col = tile % COLS;
  const polluted = battle.grid.tile(row, col).terrain === 'infection'
    || zones.some(zone => !elapsed(battle.time, zone.until) && (zone.kind === 'pollution'
      ? inRadius(source, zone.x, zone.y, zone.radius)
      : zone.kind === 'originiumPollution' && tile === zone.y * COLS + zone.x));
  const constructNearby = !polluted && battle.enemies.some(other => other !== source && onField(other)
    && DECAY_CONSTRUCTS.has(nativeKind(other)) && api.sameSeat(source, other) && tileDistance(tile, tileKeyOf(other)) <= 1);
  if (polluted || constructNearby) {
    battle.dealElementDamage({
      source, target, element: 'necrosis', amount: source.s.atk * numberAt(tier, 0.12, 0.22),
      tags: ['invasionBond', 'invasionDecay'],
    });
  }
}

function causesPhantasmDebuff(buff) {
  return buff.key === 'ab:parasite' || buff.mods?.aspd < 0 || buff.mods?.blockCnt < 0
    || buff.mods?.healingTakenMul < 1 || buff.flags?.noHeal || buff.flags?.healFree;
}

function addPhantasmDamage(battle, api, zones, cooldowns, source, target, dmg) {
  const tier = api.tier(source, PHANTASM);
  if (!tier || dmg.tags.includes('invasionBond')) return;
  const key = JSON.stringify([api.seat(source), unitKey(battle, target)]);
  if (!elapsed(battle.time, cooldowns.get(key) ?? -Infinity)) return;
  const species = memberSpecies(source);
  const qualifies = other => api.tier(other, PHANTASM) && api.sameSeat(source, other)
    && memberSpecies(other) && memberSpecies(other) !== species;
  const debuffed = target.buffs.some(buff => {
    if (!causesPhantasmDebuff(buff)) return false;
    if (qualifies(buff.source ?? buff.data?.src)) return true;
    const sources = buff.data?.invasionSources;
    if (sources) for (const entry of sources.values()) {
      if (!elapsed(battle.time, entry.until) && qualifies(entry.source)) return true;
    }
    return false;
  });
  const inCloud = !debuffed && areaSelectable(null, target)
    && zones.some(zone => zone.kind === 'poison' && !elapsed(battle.time, zone.until) && qualifies(zone.source)
      && inRadius(target, zone.x, zone.y, zone.radius));
  if (!debuffed && !inCloud) return;
  cooldowns.set(key, battle.time + 6);
  battle.dealDamage({
    source, target, amount: source.s.atk * numberAt(tier, 0.25, 0.45), type: 'arts', attackType: 'ADDITION',
    tags: ['invasionBond', 'invasionPhantasm'],
  });
}

function dropInfection(battle, api, infection, enemy) {
  const tier = api.tier(enemy, INFECTION);
  const tile = tileKeyOf(enemy);
  if (!tier || tile < 0 || !(enemy.s.atk > 0)) return;
  const row = Math.floor(tile / COLS);
  const col = tile % COLS;
  if (!battle.grid.inRect(row, col)) return;
  const zone = { tile, until: battle.time + 4, source: enemy, damage: enemy.s.atk * numberAt(tier, 0.12, 0.22) };
  infection.zones.push(zone);
  for (const [dy, dx] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const y = row + dy;
    const x = col + dx;
    if (battle.grid.inRect(y, x)) battle.fx('zone', { x, y, r: 0.5, dur: 4, kind: 'invasionInfection' });
  }
  // A single pulse clock makes overlapping zones compete once per second even if their deaths were staggered.
  infection.pulse ??= battle.every(1, () => {
    infection.zones = infection.zones.filter(area => battle.time <= area.until + EPSILON);
    for (const target of battle.allies()) {
      if (!onField(target)) continue;
      const targetTile = tileKeyOf(target);
      let strongest = null;
      for (const area of infection.zones) {
        if (tileDistance(targetTile, area.tile) <= 1 && (!strongest || area.damage > strongest.damage)) strongest = area;
      }
      if (!strongest) continue;
      battle.dealDamage({
        source: null, credit: strongest.source, target, amount: strongest.damage, type: 'arts', attackType: 'BUFF',
        dodgeMode: 'ignore', tags: ['invasionBond', 'invasionInfection', 'dot', 'periodic'],
      });
    }
    if (!infection.zones.length) {
      infection.pulse.cancel();
      infection.pulse = null;
    }
  });
}

export function installInvasionMainBonds(battle, api) {
  const formation = new Set();
  const music = new Map();
  const phantasmCooldowns = new Map();
  const nativeZones = [];
  const infection = { zones: [], pulse: null };

  battle.on('enemySpawn', ({ enemy, parent, offspringKind }) => {
    if (!enemy.invasionBonds) return;
    birthArtifact(battle, api, enemy, parent, offspringKind);
    applyDroneShield(battle, api, enemy);
    startVariation(battle, api, enemy, music);
    if (api.tier(enemy, REUNION) || api.tier(enemy, ABYSS)) {
      formation.add(enemy);
      updateFormation(battle, api, formation);
    }
  });
  battle.on('death', ({ unit, reason }) => {
    if (unit.side !== 'enemy') return;
    if (formation.delete(unit)) updateFormation(battle, api, formation);
    if (reason !== 'killed') return;
    dropInfection(battle, api, infection, unit);
    if (api.tier(unit, SEABORN) !== 2 || unit.invasionBonds.offspringKind === SEABORN_SPLIT) return;
    const childKey = unit.motion === 'FLY' ? 'enemy_1435_dsflys' : 'enemy_1433_dsbasi';
    spawnChildren(battle, unit, childKey, 1, { countInTotal: true, offspringKind: SEABORN_SPLIT });
  });
  battle.on('damageOutput', ctx => {
    const { source, credit, target, dmg } = ctx;
    if (!defender(target) || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    const attacker = source ?? credit;
    const tier = api.tier(attacker, COURT);
    if (tier && target.findBuff(COURT + ':' + api.seat(attacker))) ctx.amount *= numberAt(tier, 1.12, 1.22);
  });
  battle.on('damageApplied', ({ source, credit, target, dmg }) => {
    if (!defender(target)) return;
    const attacker = source ?? credit;
    markCourtTarget(battle, api, attacker, target);
    if (!onField(target)) return;
    if (api.tier(attacker, SEABORN) && !dmg.tags.includes('burst') && !dmg.tags.includes('invasionBond')) {
      battle.dealElementDamage({
        source, credit, target, element: 'neural', amount: attacker.s.atk * SEABORN_NEURAL,
        ignoreSelect: dmg.ignoreSelect, ignoreSleep: dmg.ignoreSleep, tags: ['invasionBond', 'invasionSeaborn'],
      });
    }
    if (onField(target)) addPhantasmDamage(battle, api, nativeZones, phantasmCooldowns, source, target, dmg);
  });
  battle.on('damaged', ({ source, target, dmg }) => {
    if (!defender(target) || !onField(target) || !dmg || dmg.type === 'element' || isHpLoss(dmg)) return;
    addDecayGauge(battle, api, nativeZones, source, target, dmg);
  });
  battle.on('elementBurst', ctx => {
    const { source, credit, target, element } = ctx;
    if (element !== 'neural' || !defender(target)) return;
    const tier = api.tier(source ?? credit, SEABORN);
    if (tier) ctx.neuralMultiplier *= numberAt(tier, 1.2, 1.5);
  });
  battle.on('enemyTargetOrder', ({ attacker, candidates }) => prioritizeShieldedDrones(battle, api, attacker, candidates));
  battle.on('enemyZoneSpawn', zone => {
    const { kind, duration, radius } = zone;
    if (!(duration > 0) || !(radius >= 0) || (kind !== 'pollution' && kind !== 'poison' && kind !== 'originiumPollution')) return;
    if (kind === 'poison' && !api.tier(zone.source, PHANTASM)) return;
    nativeZones.push({ ...zone, until: battle.time + duration });
  });
  battle.on('tick', () => {
    if (formation.size) updateFormation(battle, api, formation);
    for (let i = nativeZones.length - 1; i >= 0; i--) {
      if (elapsed(battle.time, nativeZones[i].until)) nativeZones.splice(i, 1);
    }
  });
}

