import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVersionData } from '../game/server/data.js';
import { GameData } from '../game/server/match/gamedata.js';
import { VERSIONS } from '../game/shared/versions.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const invisible = 'mon_sub_invisible';
const infection = 'mon_main_infection';
const exclusions = [
  ['enemy_1043_zomsbr', '宿主士兵', invisible, 'mon_main_reunion'],
  ['enemy_10042_prtrop', '架桥船工', invisible, 'mon_minor_water'],
  ['enemy_10043_sailor', '寻险水手', invisible, 'mon_minor_water'],
  ['enemy_1381_winman', '访问团新兵', invisible, 'mon_minor_visitor'],
  ['enemy_1325_cbgpro', '军用猎狗', infection, 'mon_sub_special'],
  ['enemy_1000_gopro_2', '猎狗pro', infection, 'mon_sub_special'],
];

test('catalogue exclusions affect bond membership, not native enemy tags or the recruitment roster', () => {
  const { units } = read('../data/units.json');
  const { bonds } = read('../data/bonds.json');
  for (const [enemy, name, removed] of exclusions) {
    const unit = units.find(({ id }) => id === enemy);
    assert.equal(unit?.name, name);
    const bond = bonds.find(({ id }) => `mon_${id}` === removed);
    assert.ok(!bond.members.includes(enemy), `${name} is not listed in ${bond.name}`);
    assert.equal(bond.memberCount, bond.members.length);
    if (removed === invisible) {
      assert.ok(unit.acTypes.includes('INVISIBLE'), `${name} keeps its original enemy metadata`);
      assert.ok(!unit.subKeys.includes('INVISIBLE'));
    } else {
      assert.ok(unit.tags.includes('infection'), `${name} keeps its original enemy metadata`);
      assert.ok(!unit.bondKeys.includes('infection'));
    }
  }
});

for (const version of [undefined, ...VERSIONS.map(({ id }) => id)]) {
  test(`${version ?? 'default'}: the removed covenants do not return on promotion`, () => {
    const gd = new GameData(getVersionData(version), 'mode_multi_normal');
    for (const [enemy, name, removed, kept] of exclusions) {
      const id = `chess_mon_${enemy}`;
      assert.equal(gd.chess(id)?.name, name);
      assert.ok(gd.visibleChess.includes(id), `${name} remains available for recruitment`);
      for (const form of [id, `${id}_b`]) {
        const record = gd.chess(form);
        assert.ok(record && !record.bonds.includes(removed), `${form} is outside ${removed}`);
        assert.ok(record.bonds.includes(kept), `${form} retains ${kept}`);
        if (removed === infection) assert.equal(record.nationId, 'monpow_none');
      }
    }
  });
}

