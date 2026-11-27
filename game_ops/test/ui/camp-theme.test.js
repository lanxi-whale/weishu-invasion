import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invasionManifest } from '../../public/js/ui/campTheme.js';
import { data } from '../../public/js/data.js';
import { bondIconUrl } from '../../public/js/ui/assetUrls.js';

test('invasion emblems replace single-letter placeholders while alliance icons keep their manifest', async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ groups: {} }) });
  try { await data.load('local'); } finally { globalThis.fetch = fetch; }
  data.setView('local', () => ({ groups: { 'ui/invasion-bonds': {
    mon_main_drone: { path: '/assets/local/ui/invasion-bonds/mon_main_drone.svg' },
  } } }));
  try {
    const manifest = { bonds: { yanShip: '/alliance.svg', mon_main_drone: '/old.png' } };
    assert.equal(bondIconUrl(manifest, 'mon_main_drone'), '/assets/local/ui/invasion-bonds/mon_main_drone.svg');
    assert.equal(bondIconUrl(manifest, 'yanShip'), '/alliance.svg');
    assert.equal(bondIconUrl(manifest, 'mon_unknown'), null);
  } finally {
    data.setView('local', null);
  }
});

test('invasion colours replace only installed UI chrome without mutating shared art', () => {
  const original = { path: '/green.webp' };
  const red = { path: '/red.webp' };
  const portrait = { path: '/theresa.webp' };
  const manifest = { groups: {
    'ui/outer': { btn_match: original, missingVariant: original },
    'ui/camps': { theresa: portrait },
    'ui/invasion': { 'ui/outer/btn_match': red },
    stages: { stage: original },
  } };
  const themed = invasionManifest(manifest);
  assert.equal(themed.groups['ui/outer'].btn_match, red);
  assert.equal(themed.groups['ui/outer'].missingVariant, original);
  assert.equal(themed.groups['ui/camps'], manifest.groups['ui/camps']);
  assert.equal(themed.groups.stages, manifest.groups.stages);
  assert.equal(manifest.groups['ui/outer'].btn_match, original);
  assert.equal(invasionManifest(manifest), themed, 'stable view avoids rebuilding every frame');
  assert.equal(invasionManifest(null), null);
  assert.equal(invasionManifest({ groups: {} }).groups !== undefined, true);
});
