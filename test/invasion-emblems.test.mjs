import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const json = (path) => JSON.parse(read(path));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const group = 'ui/invasion-bonds';
const court = 'mon_main_court';
const courtPath = `/assets/local/${group}/mon_main_court-3041bcd66520.svg`;
const courtHash = '3041bcd66520f106b2e6fc3b93a56497d2e9a62d0df8b024d566aec77aa7de29';
const oldDecayHash = '812d60ef7d215a789c4497f4df7b290f0ae3f63510a34e81925192a3213aee0b';

test('the regular Sarkaz emblem retains its exact original file and URL', () => {
  for (const camp of ['game', 'game_ops']) {
    const entry = json(`${camp}/data/local-assets.json`).groups[group][court];
    assert.equal(entry.path, courtPath);
    assert.equal(hash(read(`${camp}/public${entry.path}`)), courtHash, camp);
  }
});

test('every other invasion bond uses a distinct, flat emblem on both clients', () => {
  const bonds = json('game/data/bonds.json');
  const invasion = json('game/data/local-assets.json').groups[group];
  assert.deepEqual(Object.keys(invasion).sort(), Object.keys(bonds).sort());
  assert.deepEqual(json('game_ops/data/local-assets.json').groups[group], invasion);
  const motifs = new Set();
  for (const [id, entry] of Object.entries(invasion)) {
    if (id === court) continue;
    assert.equal(entry.kind, 'OriginalVectorEmblem', id);
    const bytes = read(`game/public${entry.path}`);
    const digest = hash(bytes);
    assert.equal(entry.path, `/assets/local/${group}/${id}-${digest.slice(0, 12)}.svg`);
    if (id === 'mon_main_decay') assert.notEqual(digest, oldDecayHash);
    assert.deepEqual(read(`game_ops/public${entry.path}`), bytes, id);
    const svg = bytes.toString('utf8');
    const silhouette = svg.match(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64">\s*<path fill="#fff0ed" fill-rule="evenodd" d="([^"]+)"\s*\/>\s*<\/svg>\s*$/)?.[1];
    assert.ok(silhouette && !motifs.has(silhouette), `${id} has a distinct pale silhouette`);
    motifs.add(silhouette);
  }
  assert.equal(motifs.size, Object.keys(bonds).length - 1);
});
