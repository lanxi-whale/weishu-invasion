import fs from 'node:fs';

const roundScaling = JSON.parse(fs.readFileSync(new URL('../../../data/round_scaling.json', import.meta.url), 'utf8'));

const bonuses = [
  { id: 'invasion_drill', name: '战地整训', desc: '本局你的所有怪物生命上限、攻击力和防御力 +5%。', stats: { maxHp: 5, atk: 5, def: 5 } },
  { id: 'invasion_reinforcements', name: '增员指令', desc: '下一次成功购买的怪物单位内增加 1 只怪物，升阶时保留。', extraMembers: 1 },
  { id: 'invasion_vitality', name: '耐力训练', desc: '本局你的所有怪物生命上限 +10%。', stats: { maxHp: 10 } },
  { id: 'invasion_attack', name: '火力训练', desc: '本局你的所有怪物攻击力 +10%。', stats: { atk: 10 } },
  { id: 'invasion_armor', name: '护甲强化', desc: '本局你的所有怪物防御力 +10%。', stats: { def: 10 } },
  { id: 'invasion_funds', name: '作战拨款', desc: '立即获得 4 点资金。', funds: 4 },
  { id: 'invasion_refresh', name: '紧急调度', desc: '获得 2 次免费刷新商店的机会。', refreshes: 2 },
];

export function invasionDraft(rng, count) {
  const cards = rng.shuffle(bonuses.slice()).slice(0, count).map((bonus, idx) => ({
    id: bonus.id, name: bonus.name, desc: bonus.desc, idx, kind: 'invasion', family: 'invasion',
  }));
  return { family: 'invasion', name: '侵略加成', desc: '免费选择一项加成。', eventId: null, cards };
}

export function grantInvasionBonus(player, id) {
  const bonus = bonuses.find(option => option.id === id);
  if (!bonus) return;
  if (bonus.stats) {
    const stats = player.invasionStatBonus ||= {};
    for (const [key, percent] of Object.entries(bonus.stats)) stats[key] = (stats[key] || 0) + percent;
  }
  if (bonus.extraMembers) player.nextInvasionExtraMembers = (player.nextInvasionExtraMembers || 0) + bonus.extraMembers;
  if (bonus.funds) player.addFunds(bonus.funds, { reason: 'choice' });
  if (bonus.refreshes) player.shop.freeRefreshes += bonus.refreshes;
}

export function boostInvasionStats(player, stats) {
  if (!player.invasionStatBonus || !stats) return stats;
  const boosted = { ...stats };
  for (const [key, percent] of Object.entries(player.invasionStatBonus)) {
    if (Number.isFinite(boosted[key])) boosted[key] *= 1 + percent / 100;
  }
  return boosted;
}

export function scaleInvasionRound(stats, round) {
  const scaled = { ...stats };
  for (const [key, multiplier] of Object.entries(roundScaling.curve[round] ?? {})) {
    if (Number.isFinite(scaled[key])) scaled[key] *= multiplier;
  }
  return scaled;
}
