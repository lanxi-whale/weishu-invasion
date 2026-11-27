import fs from 'node:fs';
import { tierFor } from './bondsMeta.js';

const rules = JSON.parse(fs.readFileSync(new URL('../../../data/monster_bond_effects.json', import.meta.url), 'utf8'));
export const monsterCountBondIds = Object.freeze(Object.keys(rules.bonds));
export const monsterSpawnInterval = rules.spawnInterval;

export function sizeMonsterLineup(lineup, gd = null, disabledBonds = []) {
  const off = new Set([...disabledBonds, ...(gd?.modeInactiveBonds || [])]);
  const byPlayer = new Map();
  const records = lineup.map((unit) => {
    const record = gd?.chess(unit.chessId);
    const star = record?.isGolden || /_b$/.test(unit.chessId) ? 2 : 1;
    const normalCount = rules.baseCountByTier[record?.tier]?.[star] ?? rules.baseCountByStar[star];
    const pompeiiExtra = unit.strategy === 'pompeii' && record?.bonds?.includes('mon_main_slug') ? 1 : 0;
    const baseCount = normalCount + pompeiiExtra;
    const species = record?.baseId ?? String(unit.chessId).replace(/_b$/, '');
    const bonds = (record?.bonds ?? []).filter(id => id.startsWith('mon_'));
    const player = unit.sourcePlayerId ?? null;
    if (!byPlayer.has(player)) byPlayer.set(player, new Map());
    const members = byPlayer.get(player);
    for (const id of bonds) {
      if (!members.has(id)) members.set(id, new Set());
      members.get(id).add(species);
    }
    return { unit, star, baseCount, bonds, members, species };
  });
  return records.map(({ unit, star, baseCount, bonds, members, species }) => {
    let count = baseCount + (unit.extraMembers || 0);
    const tiers = {};
    for (const id of bonds) {
      const distinct = members.get(id).size;
      const bond = gd?.bond?.(id);
      if (bond && !gd.modeInactiveBonds?.has(id)) {
        const tier = tierFor(bond, distinct);
        if (tier > 0 && (!rules.bonds[id] || !off.has(id))) tiers[id] = tier;
      }
      if (off.has(id)) continue;
      const countBonus = rules.bonds[id]?.findLast(entry => distinct >= entry.distinctSpecies);
      count += countBonus?.extraPerUnit ?? 0;
    }
    const invasionBonds = { tiers, members: bonds, species, seat: unit.sourcePlayerId ?? null,
      gate: unit.gateIndex === 1 ? 'lower' : 'upper' };
    return { ...unit, star, count, invasionBonds };
  });
}
