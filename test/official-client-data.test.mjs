import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getVersionData as operatorData } from '../game_ops/server/data.js';
import { getVersionData as monsterData } from '../game/server/data.js';
import { VERSIONS } from '../game/shared/versions.js';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
const installed = operatorData('act3autochess@V3_1');
const monster = monsterData('act3autochess@V3_1');
const local = fs.existsSync(new URL('local-client-data/manifest.json', root));
const correctedStats = {
  enemy_2001_duckmi: [[6000, 100], [18000, 100]],
  enemy_2002_bearmi: [[11000, 1600], [30000, 2000]],
  enemy_2034_sythef: [[4500, 300], [8000, 300]],
  enemy_2085_skzjxd: [[13000, 500], [50000, 500]],
};

test('both camps load the installed official client revision and share enemy definitions', () => {
  assert.equal(installed.config.officialData.kind, 'local-client');
  assert.deepEqual(monster.config.officialData, installed.config.officialData);
  assert.deepEqual(monster.enemies, installed.enemies);
  assert.equal(Object.keys(installed.chess).length, 310);
  assert.equal(installed.config.monsterOnly, undefined);
  assert.equal(monster.config.monsterOnly, true);
});

test('native monster forms use official per-variant attributes with the invasion star corrections', () => {
  let checked = 0;
  for (const c of Object.values(monster.chess)) {
    if (!c.chessId.startsWith('chess_mon_')) continue;
    const native = installed.enemies[c.assets.avatar];
    if (!native) continue; // Synthetic second stars keep the custom 4v4 upgrade ratio.
    const corrected = correctedStats[c.baseId.slice('chess_mon_'.length)]?.[Number(c.isGolden)];
    const expected = corrected ? { ...native.stats, maxHp: corrected[0], atk: corrected[1] } : native.stats;
    for (const key of ['maxHp', 'atk', 'def', 'res', 'bat', 'aspd', 'moveSpeed', 'hpRecoveryPerSec']) {
      assert.equal(c.stats[key], expected[key], `${c.chessId}.${key}`);
    }
    checked++;
  }
  assert.ok(checked > 200, `only ${checked} native variants checked`);
});

test('the corrected star attributes reach every invasion version and the bestiary', () => {
  const { units } = read('data/units.json');
  const file = fs.readFileSync(new URL('怪物图鉴/data.js', root), 'utf8').trim();
  const { groups } = JSON.parse(file.slice('window.MONSTERS = '.length, -1));
  const catalogue = new Map(groups.flatMap(({ items }) => items.map((item) => [item.id, item])));
  const versions = [undefined, ...VERSIONS.map(({ id }) => id)].map((version) => monsterData(version));
  for (const [enemyId, expected] of Object.entries(correctedStats)) {
    const id = 'chess_mon_' + enemyId;
    const unit = units.find((u) => u.id === enemyId);
    assert.deepEqual([unit.hp, unit.atk], expected[0]);
    assert.deepEqual(unit.stars.map(({ hp, atk }) => [hp, atk]), expected);
    const forms = [enemyId, enemyId + '_2'];
    assert.deepEqual(forms.map((key) => [catalogue.get(key).hp, catalogue.get(key).atk]), expected);
    for (const { chess } of versions) {
      assert.deepEqual([chess[id], chess[id + '_b']].map(({ stats }) => [stats.maxHp, stats.atk]), expected);
      assert.deepEqual([chess[id].assets.avatar, chess[id + '_b'].assets.avatar], forms);
    }
  }
});

test('installed operator records match the validated local build and source fingerprints', { skip: !local }, () => {
  for (const name of ['chess', 'enemies', 'waves', 'items', 'bands', 'effects', 'backups']) {
    assert.deepEqual(installed[name], read(`local-client-data/built/${name}.json`), name);
  }
  const manifest = read('local-client-data/manifest.json');
  assert.equal(installed.config.officialData.version, manifest.version);
  for (const [name, hash] of Object.entries(installed.config.officialData.tables)) {
    const bytes = fs.readFileSync(new URL(`local-client-data/${name}.bytes`, root));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash, name);
  }
  assert.deepEqual(read('local-client-data/build-report.json').errors, []);
});
