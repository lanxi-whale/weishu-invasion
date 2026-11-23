import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../game/server/data.js';
import { GameData } from '../game/server/match/gamedata.js';
import { drawDisabledBonds } from '../game/server/match/pool.js';
import { createRng } from '../game/server/sim/rng.js';
import { makeMatch } from '../game/test/match/harness.js';

test('all monster versions and modes enable exactly five core covenants', () => {
  for (const version of [undefined, 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1', 'act3autochess@V3_1']) {
    const data = getVersionData(version);
    for (const mode of Object.keys(data.config.modes)) {
      const gd = new GameData(data, mode);
      for (let seed = 1; seed <= 10; seed++) {
        const draw = drawDisabledBonds(gd, createRng(seed));
        for (const idx of draw.choice ? [0, 1] : [null]) {
          const off = new Set([...draw.staticOff, ...draw.drawn, ...(idx === null ? [] : draw.choice.groups[1 - idx])]);
          assert.equal(gd.bondIds.filter(id => gd.bond(id).isCore && !off.has(id)).length, 5, `${version} ${mode} seed ${seed}`);
        }
      }
    }
  }
});

test('solo group selection retains five enabled monster cores in actual match state', () => {
  for (const idx of [0, 1]) {
    const h = makeMatch({ mode: 'solo', modeId: 'mode_single_6', data: getVersionData('act3autochess@V3_1') });
    try {
      h.start();
      const m = h.m;
      assert.equal(m.pickBondGroup(m.order[0], idx, m.setupRevision).ok, true);
      const off = new Set([...m.disabledBonds, ...m.staticInactiveBonds]);
      assert.equal(m.gd.bondIds.filter(id => m.gd.bond(id).isCore && !off.has(id)).length, 5);
      assert.equal(m.bondChoice.groups[idx].length, 5);
    } finally { h.m.dispose(); }
  }
});

test('the seeded invasion pool limits each enabled core to ten distinct monsters', () => {
  const data = getVersionData('act3autochess@V3_1');
  const gd = new GameData(data, 'mode_multi_normal');
  const keep = new Set();
  for (let seed = 1; seed <= 16; seed++) {
    const draw = drawDisabledBonds(gd, createRng(seed));
    assert.deepEqual(drawDisabledBonds(gd, createRng(seed)), draw);
    const disabled = new Set([...draw.drawn, ...draw.staticOff]);
    const blacklisted = new Set(draw.banned);
    const pool = gd.visibleChess.filter(id => !blacklisted.has(id));
    keep.add(JSON.stringify(pool));
    assert.ok(pool.some(id => gd.chess(id).price === 2));
    for (const bondId of gd.bondIds.filter(id => gd.bond(id).isCore && !disabled.has(id))) {
      const members = pool.filter(id => gd.chess(id).bonds.includes(bondId));
      assert.ok(members.length > 0 && members.length <= 10, `${bondId}, seed ${seed}, members ${members.length}`);
    }
  }
  assert.ok(keep.size > 1);
});
