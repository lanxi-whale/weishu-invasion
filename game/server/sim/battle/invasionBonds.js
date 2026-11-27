import { installInvasionMainBonds } from './invasionBondsMain.js';
import { installInvasionMinorBonds } from './invasionBondsMinor.js';
import { installInvasionSubBonds } from './invasionBondsSub.js';

const inheritedBonds = new Set(['mon_main_yan', 'mon_main_seaborn', 'mon_main_decay', 'mon_sub_times', 'mon_sub_reborn']);

export function invasionOffspringBonds(parent, kind) {
  const original = parent.invasionBonds;
  if (!original) return null;
  const members = (original.members ?? []).filter(id => inheritedBonds.has(id));
  const tiers = Object.fromEntries(Object.entries(original.tiers ?? {}).filter(([id]) => inheritedBonds.has(id)));
  return { seat: original.seat, species: original.species, gate: original.gate, members, tiers, offspring: true, offspringKind: kind };
}

export function installInvasionBonds(battle, enemy) {
  if (battle._invasionBondUses || !Object.keys(enemy.invasionBonds?.tiers ?? {}).length) return;
  const used = new Map(Object.entries(battle.flags.invasionBondUses ?? {}));
  battle._invasionBondUses = used;
  const seat = unit => unit?.invasionBonds ? unit.invasionBonds.seat ?? unit.sourcePlayerId ?? null : null;
  const api = {
    seat,
    sameSeat: (left, right) => !!left?.invasionBonds && !!right?.invasionBonds && seat(left) === seat(right),
    tier: (unit, id) => unit?.invasionBonds?.tiers?.[id] ?? 0,
    take(unit, effect, limit = 1) {
      const key = JSON.stringify([seat(unit), effect]);
      const count = used.get(key) ?? 0;
      if (count >= limit) return false;
      used.set(key, count + 1);
      return true;
    },
  };
  installInvasionMainBonds(battle, api);
  installInvasionMinorBonds(battle, api);
  installInvasionSubBonds(battle, api);
}
