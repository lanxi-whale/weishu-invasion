import { currentInvasionOrder } from './invasionCommands.js';
import { MONSTER_GATES } from './monsterWave.js';

const ground = s => !s.preview.fly;
const upper = s => s.preview.gate === 'upper';

/** Mark the first actual creatures, accounting for interleaved departure times of different cards. */
function firstMembers(spawns, limit, matches, selected) {
  const candidates = [];
  for (const spawn of spawns) {
    if (!matches(spawn)) continue;
    for (let i = 0; i < Math.min(limit, spawn.count); i++) {
      candidates.push({ spawn, time: spawn.time + i * spawn.interval });
    }
  }
  candidates.sort((a, b) => a.time - b.time);
  for (const { spawn } of candidates.slice(0, limit)) selected.set(spawn, (selected.get(spawn) ?? 0) + 1);
}

function moveGate(spawn) {
  const index = upper(spawn) ? 1 : 0;
  return { ...spawn, preview: { ...spawn.preview, gate: index === 0 ? 'upper' : 'lower', start: [...MONSTER_GATES[index]] } };
}

function advanceBatch(spawns, target) {
  const first = spawns.find(s => s.uid === target.uid);
  const later = spawns.find(s => s.uid === target.otherUid);
  if (!first || !later || first.preview.gate !== later.preview.gate || first.batch >= later.batch || first.time >= later.time) return spawns;
  const moved = Math.min(later.count, 3);
  return spawns.flatMap(spawn => {
    if (spawn !== later) return [spawn];
    const early = { ...later, count: moved, batch: first.batch, time: first.time };
    if (moved === later.count) return [early];
    return [early, { ...later, count: later.count - moved, time: later.time + moved * later.interval }];
  });
}

function markCombatSpawns(spawns, kind, target, round) {
  const selected = new Map();
  const first = (limit, matches) => firstMembers(spawns, limit, matches, selected);
  const byGate = (limit, matches) => {
    first(limit, s => upper(s) && matches(s));
    first(limit, s => !upper(s) && matches(s));
  };
  switch (kind) {
    case 'heavyCover':
      if (target) first(3, s => ground(s) && s.preview.gate === target.gate);
      break;
    case 'ram': byGate(1, ground); break;
    case 'doubleGate':
      if (spawns.filter(upper).length >= 2 && spawns.filter(s => !upper(s)).length >= 2) byGate(3, () => true);
      break;
    case 'armorPiercing': first(3, s => s.attackType === 'RANGED'); break;
    case 'highGround':
      if (target) first(2, s => s.uid === target.uid && s.attackType === 'RANGED');
      break;
    case 'slipstream':
      if (target && round >= 4) first(round >= 8 ? 2 : 1, s => s.uid === target.uid && ground(s));
      break;
    case 'saltErosion': first(2, s => s.attackType === 'MELEE'); break;
    case 'shadowRaid': {
      let upperCount = 0, lowerCount = 0;
      for (const s of spawns.filter(ground)) {
        if (upper(s)) upperCount += s.count;
        else lowerCount += s.count;
      }
      if (upperCount && lowerCount) {
        if (upperCount === lowerCount) byGate(1, ground);
        else first(2, s => ground(s) && upper(s) === (upperCount < lowerCount));
      }
      break;
    }
    case 'coldTide':
    case 'cocoon':
    case 'vineRelay':
    case 'bounty':
      for (const s of spawns) {
        if (kind === 'vineRelay' && !ground(s)) continue;
        if (kind === 'bounty' && (round < 5 || s.tier < 5 || s.tier > 6)) continue;
        selected.set(s, s.count);
      }
      break;
    default: return spawns;
  }
  return spawns.flatMap(spawn => {
    const count = selected.get(spawn);
    if (!count) return [spawn];
    const marked = { ...spawn, count, invasion: { kind, gate: spawn.preview.gate } };
    if (count === spawn.count) return [marked];
    return [marked, { ...spawn, count: spawn.count - count, time: spawn.time + count * spawn.interval }];
  });
}

/** Keep command previews and combat on the same schedule, grouping quotas by invasion player. */
export function applyInvasionOrders(match, spawns) {
  const groups = new Map();
  for (const spawn of spawns) {
    if (!groups.has(spawn.sourcePlayerId)) groups.set(spawn.sourcePlayerId, []);
    groups.get(spawn.sourcePlayerId).push(spawn);
  }
  const result = [];
  for (const [id, units] of groups) {
    const player = match.players.get(id);
    const kind = player && match.gd.band(player.bandId)?.invasionStrategy?.kind;
    const order = currentInvasionOrder(player);
    const target = order?.kind === kind ? order?.target : null;
    if (kind === 'gateSwap' && target) result.push(...units.map(s => s.uid === target.uid ? moveGate(s) : s));
    else if (kind === 'batchAdvance' && target) result.push(...advanceBatch(units, target));
    else result.push(...markCombatSpawns(units, kind, target, match.round));
  }
  return result.sort((a, b) => a.time - b.time);
}
