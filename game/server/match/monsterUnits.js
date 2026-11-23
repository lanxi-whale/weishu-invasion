import fs from 'node:fs';

const rules = JSON.parse(fs.readFileSync(new URL('../../../data/monster_bond_effects.json', import.meta.url), 'utf8'));
export const monsterCountBondIds = Object.freeze(Object.keys(rules.bonds));
export const monsterSpawnInterval = rules.spawnInterval;

export function sizeMonsterLineup(lineup, gd = null, disabledBonds = []) {
  const off = new Set([...disabledBonds, ...(gd?.modeInactiveBonds || [])]);
  const activeRules = monsterCountBondIds.filter((id) => !off.has(id));
  const byPlayer = new Map();
  const records = lineup.map((unit) => {
    const record = gd?.chess(unit.chessId);
    const star = record?.isGolden || /_b$/.test(unit.chessId) ? 2 : 1;
    const normalCount = rules.baseCountByTier[record?.tier]?.[star] ?? rules.baseCountByStar[star];
    const pompeiiExtra = unit.strategy === 'pompeii' && record?.bonds?.includes('mon_main_slug') ? 1 : 0;
    const baseCount = normalCount + pompeiiExtra;
    const species = record?.baseId ?? String(unit.chessId).replace(/_b$/, '');
    const bonds = activeRules.filter((id) => record?.bonds?.includes(id));
    const player = unit.sourcePlayerId ?? null;
    if (!byPlayer.has(player)) byPlayer.set(player, new Map());
    const members = byPlayer.get(player);
    for (const id of bonds) {
      if (!members.has(id)) members.set(id, new Set());
      members.get(id).add(species);
    }
    return { unit, star, baseCount, bonds, members };
  });
  return records.map(({ unit, star, baseCount, bonds, members }) => {
    let count = baseCount + (unit.extraMembers || 0);
    for (const id of bonds) {
      const tier = rules.bonds[id].findLast((entry) => members.get(id).size >= entry.distinctSpecies);
      count += tier?.extraPerUnit ?? 0;
    }
    return { ...unit, star, count };
  });
}
