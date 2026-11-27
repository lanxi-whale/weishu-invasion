import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, FxSystem;
before(async () => {
  fake = installFakePixi();
  ({ FxSystem } = await import('../../public/js/render/fx.js'));
});
after(() => fake.restore());

const camera = presetCamera('normal', { width: 1440, height: 900 });
const unit = (id, spine, fields = {}) => ({
  id, x: id + 3, y: 10, z: 0, hover: 0, maxHp: 500, alive: true, isEnemy: spine.startsWith('enemy_'),
  info: { defId: 'piece-id', spine }, ...fields,
});

function makeFx(settings = {}) {
  const { P } = fake;
  return new FxSystem({
    P, layers: fakeViewCtx(P).layers, cam: () => camera, heightAt: () => 0, timeScale: () => 2,
    settings: { quality: 'high', ...settings }, view: () => null, subProfOf: () => 'splashcaster',
    screenSize: () => ({ width: 1440, height: 900 }), fieldTop: () => 120,
  });
}

test('a hit already drawn by official effects keeps hit feedback and numbers without adding particles or a splash ring', () => {
  const fx = makeFx();
  const attacker = unit(1, 'char_134_ifrit');
  let hits = 0;
  const target = unit(2, 'enemy_1007_slime', { onHit: () => { hits++; } });
  fx.attack(attacker, target, 'none');
  fx.damage(target, 20, 'phys', attacker, undefined, { noSpark: true });
  assert.equal(fx.parts.length, 0);
  assert.equal(fx.rings.length, 0);
  assert.equal(fx.nums[0].value, 20);
  assert.equal(hits, 1);
  fx.attack(attacker, target, 'none');
  fx.damage(target, 20, 'phys', attacker);
  assert.ok(fx.parts.some(part => part.sp.texture === fx.tex.slash));
  assert.equal(fx.rings.length, 1);
  fx.destroy();
});

test('a skill whose official effect is unavailable gets just a short cue on the unit, not a ground ring', () => {
  const fx = makeFx({ quality: 'low' });
  const swords = unit(1, 'char_1028_texas2', { skillIndex: 2 });
  const marksman = unit(2, 'char_103_angel', { info: { spine: 'char_103_angel', ammoSkill: true } });
  const enemy = unit(3, 'enemy_1067_snslime_2');
  const groundItems = fx.ctx.layers.groundFx.children.length;
  fx.skill(swords, true);
  fx.skill(marksman, true);
  fx.skill(enemy, true);
  assert.equal(fx.parts.length, 3);
  assert.equal(fx.rings.length, 0);
  assert.equal(fx.ctx.layers.groundFx.children.length, groundItems);
  fx.skill(swords, false);
  fx.update(0.6);
  assert.equal(fx.parts.length, 0);
  fx.destroy();
});
