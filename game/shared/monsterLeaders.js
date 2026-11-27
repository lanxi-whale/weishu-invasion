// Invasion draft keeps the original ids for older seasons and carries its own strategy rules.
export const POMPEII_BAND_ID = 'band_invasion_pompeii';
export const DEFAULT_START_LP = 28;

export const MONSTER_LEADERS = [
  { bandIds: ['band_amiya'], enemyKey: 'enemy_9013_acstmk_2', name: '假想敌：胄',
    strategy: { kind: 'heavyCover', title: '重甲掩护', active: true, targetType: 'gate', cost: 1,
      desc: '消耗 1 资金选择一道红门。该门最先出场的 3 只地面怪物各获得相当于自身生命上限 20% 的护盾，持续 8 秒。' } },
  { bandIds: ['band_sarkazb'], enemyKey: 'enemy_2124_dyjsfg', name: '矩兽',
    strategy: { kind: 'ram', title: '撞阵',
      desc: '每道红门最先出场的 1 只地面怪物，第一次被阻挡时使阻挡者眩晕 1.2 秒。' } },
  { bandIds: ['band_emperor'], enemyKey: 'enemy_9013_acstmk', name: '假想敌：胄',
    strategy: { kind: 'doubleGate', title: '双门急行',
      desc: '两道红门各安排至少 2 格怪物时，每道门最先出场的 3 只怪物获得移动速度 +20%，持续 6 秒。' } },
  { bandIds: ['band_qalaisa'], enemyKey: 'enemy_9033_acdeer', name: '“萨米的意志”',
    strategy: { kind: 'coldTide', title: '寒潮',
      desc: '第一道累计有 3 只怪物被阻挡的红门触发寒潮。阻挡第 3 只怪物的干员与其相邻格的干员攻击速度 −20，持续 5 秒。' } },
  { bandIds: ['band_ioleta'], enemyKey: 'enemy_9017_achunt', name: '假想敌：铳',
    strategy: { kind: 'armorPiercing', title: '破甲射击',
      desc: '最先出场的 3 只远程怪物，各自在首次命中干员时使目标防御力 −15%，持续 5 秒。同一干员每场最多触发一次。' } },
  { bandIds: ['band_survive'], enemyKey: 'enemy_9017_achunt_2', name: '假想敌：铳',
    strategy: { kind: 'highGround', title: '高台压制', active: true, targetType: 'piece', unitType: 'ranged', cost: 1,
      desc: '消耗 1 资金选择一格远程怪物。该格最先出场的 2 只怪物，前两次普攻优先攻击射程内的高台干员，对其造成的伤害 +20%。' } },
  { bandIds: ['band_price'], enemyKey: 'enemy_9029_acfnc_2', name: '假想敌：械',
    strategy: { kind: 'supply', title: '定向补给',
      desc: '每逢偶数回合获得 1 次当回合免费刷新。当前已解锁的最高阶有库存时，这次刷新有 1 格从该阶卡池抽取。' } },
  { bandIds: ['band_transfer'], enemyKey: 'enemy_9037_aceel', name: '假想敌：鳍',
    strategy: { kind: 'gateSwap', title: '调换出口', active: true, targetType: 'piece', cost: 0,
      desc: '免费选择一格怪物，让该格从另一道红门出场。出场时机保持原样，怪物沿新红门的路线行进。' } },
  { bandIds: ['band_dance'], enemyKey: 'enemy_9037_aceel_2', name: '假想敌：鳍',
    strategy: { kind: 'slipstream', title: '潜流穿阵', active: true, targetType: 'piece', unitType: 'ground', cost: 2, unlockRound: 4,
      desc: '第 4 回合解锁。消耗 2 资金选择一格地面怪物。该格最先出场的 1 只怪物首次被阻挡时脱离阻挡，并在之后 2 秒内无法被阻挡。第 8 回合起覆盖该格最先出场的 2 只。' } },
  { bandIds: ['band_copy', 'band_dusk'], enemyKey: 'enemy_9035_acspider', name: '假想敌：茧',
    strategy: { kind: 'cocoon', title: '护茧',
      desc: '每场单独作战中，你的怪物最先召唤或分裂出的 6 只子怪各获得相当于自身生命上限 50% 的护盾和 50% 的移动速度加成，两项均持续 12 秒。死亡召唤也计入。' } },
  { bandIds: ['band_jenga'], enemyKey: 'enemy_9035_acspider_2', name: '假想敌：茧',
    strategy: { kind: 'batchAdvance', title: '并批出击', active: true, targetType: 'pair', cost: 1,
      desc: '消耗 1 资金，选择同一道红门、分属不同批次的两格怪物。后一格最多前 3 只提前到前一格的批次，仍按原间隔逐只出场。' } },
  { bandIds: ['band_evolve'], enemyKey: 'enemy_9029_acfnc', name: '假想敌：械',
    strategy: { kind: 'upgrade', title: '二星改装',
      desc: '本局前两次将 1 至 4 阶怪物合成二星时，对应单位各额外多带 1 只怪物，效果随单位保留至售出。' } },
  { bandIds: ['band_jesica'], enemyKey: 'enemy_1521_dslily', name: '盐风主教昆图斯',
    strategy: { kind: 'saltErosion', title: '盐蚀',
      desc: '最先出场的 2 只近战怪物，各自在首次命中干员时使其受到的治疗量降低 35%，持续 6 秒。重复触发会刷新时长。' } },
  { bandIds: ['band_takecare', 'band_bldsk'], enemyKey: 'enemy_2052_smgia', name: '纠缠藤蔓',
    strategy: { kind: 'vineRelay', title: '藤蔓接力',
      desc: '每场最先在被阻挡时阵亡的 2 只己方地面怪物，各在死亡格留下 5 秒藤蔓。己方怪物在藤蔓所在格获得攻击力 +20%，重叠时只计算一次。' } },
  { bandIds: ['band_shield', 'band_mberry'], enemyKey: 'enemy_2016_csphtm', name: '卢西恩，“猩红血钻”',
    strategy: { kind: 'shadowRaid', title: '幕影奇袭',
      desc: '两道红门都派出地面怪物时，地面怪物较少的一门最先出场的 2 只获得隐匿，持续 5 秒，被阻挡时解除。两门数量相同则各有 1 只获得隐匿。' } },
  { bandIds: ['band_smith'], enemyKey: 'enemy_9032_aclionk', name: '阿利斯泰尔，帝国余晖',
    strategy: { kind: 'bounty', title: '破城悬赏',
      desc: '第 5 回合起，每回合只要自己派出的 5 至 6 阶怪物有一只在单独作战中进入蓝门，下回合备战额外获得 2 资金。' } },
  { bandIds: [POMPEII_BAND_ID], enemyKey: 'enemy_1050_lslime', name: '庞培', fixedName: true,
    strategy: { kind: 'pompeii', title: '源石虫增员',
      desc: '每个部署的【源石虫】单位额外出场 1 只怪物。开局生效，可与升星和源石虫羁绊的增员叠加。' } },
];

export function monsterLeaderFor(bandId) {
  return MONSTER_LEADERS.find((row) => row.bandIds.includes(bandId)) || null;
}

/** Project an official draft row onto its invasion strategy. Old seasons retain their available aliases. */
export function monsterLeaderBand(band, enemies = {}) {
  const leader = monsterLeaderFor(band?.bandId);
  if (!leader) return null;
  const name = leader.fixedName ? leader.name : enemies[leader.enemyKey]?.name || leader.name;
  const variant = leader.enemyKey.endsWith('_2') ? ' · II' : '';
  const invasionStrategy = leader.strategy;
  const { title, desc, active } = invasionStrategy;
  const description = `【${title}】\n${active ? '备战时每回合可使用 1 次。' : '被动效果。'}${desc}`;
  return {
    ...band, name: name + variant, strategyName: title, leaderKey: leader.enemyKey,
    effectId: `invasion:${invasionStrategy.kind}`, effectName: title, desc: description, descRaw: description,
    buffs: [], skills: [], params: {}, bondIds: [], unlockDesc: null, invasionStrategy,
  };
}

export function monsterLeaderBands(bands, enemies = {}, startLp) {
  const rows = { ...bands };
  rows[POMPEII_BAND_ID] = {
    bandId: POMPEII_BAND_ID, sortId: 17, bandType: 'GENERAL', modeTypeList: null, inactiveModeIds: [],
    totalHp: Number.isInteger(startLp) && startLp > 0 ? startLp : DEFAULT_START_LP,
  };
  return Object.fromEntries(Object.values(rows).flatMap((band) => {
    const leader = monsterLeaderBand(band, enemies);
    return leader ? [[leader.bandId, leader]] : [];
  }));
}
