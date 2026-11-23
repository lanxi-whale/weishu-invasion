import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../game/server/data.js';
import { GameData } from '../game/server/match/gamedata.js';
import { computeBonds } from '../game/server/match/bondsMeta.js';

const versions = [undefined, 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1', 'act3autochess@V3_1'];
const decay = 'mon_main_decay';
const species = [
  ['chess_mon_enemy_1270_nhstlk', '逐腐兽', '疯狂的逐腐兽'],
  ['chess_mon_enemy_1425_lrcmra', '孽罪奇美拉', '渎罪奇美拉'],
];

for (const version of versions) {
  test(`${version ?? 'default'}: both 逐腐兽 and 渎罪奇美拉 contribute to 萨卡兹·枯朽`, () => {
    const gd = new GameData(getVersionData(version), 'mode_multi_normal');
    const recruitable = species.map(([id]) => id);
    for (const [id, baseName, upgradeName] of species) {
      const base = gd.chess(id);
      const upgrade = gd.chess(`${id}_b`);
      assert.equal(base?.name, baseName);
      assert.equal(upgrade?.name, upgradeName);
      assert.ok(base.bonds.includes(decay), `${baseName} joins the covenant`);
      assert.ok(upgrade.bonds.includes(decay), `${upgradeName} keeps the covenant`);
      assert.ok(gd.visibleChess.includes(id), `${baseName} remains recruitable`);
    }
    assert.ok(gd.chess(recruitable[0]).bonds.includes('mon_sub_dot'), '逐腐兽 retains 持续');

    const lineup = [
      ...recruitable.map((id) => `${id}_b`),
      ...gd.visibleChess.filter((id) => !recruitable.includes(id) && gd.chess(id).bonds.includes(decay)).slice(0, 2),
    ];
    assert.equal(lineup.length, 4);
    const stateFor = (ids) => computeBonds(gd, {
      board: new Map(ids.map((id, index) => [`unit-${index}`, { kind: 'chess', id }])),
      hand: [],
      layers: {},
    })[decay];
    const active = stateFor(lineup);
    assert.deepEqual([active.count, active.active], [4, true], 'upgraded forms activate the covenant');
    assert.equal(stateFor([...lineup, ...recruitable]).count, 4, 'base and upgraded forms count as the same species');
  });
}
