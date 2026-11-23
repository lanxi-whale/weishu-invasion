import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from '../game/test/match/harness.js';
import { getVersionData } from '../game/server/data.js';

test('regulation monster overflow is inspectable and selling it unblocks Ready', () => {
  const h = makeMatch({ mode: 'solo', modeId: 'mode_single_6', data: getVersionData('act3autochess@V3_1') });
  try {
    h.autoHumans().start().runToPhase('PREP', 1);
    const ps = h.m.order[0];
    ps.autoplay = false;
    ps.autoPickCommands();
    ps.hand.fill(null);
    ps.temp.fill(null);
    const id = [...h.m.pool.entries.keys()].find((key) => ps.gd.chess(key)?.visible);
    // Forced gains may arrive even with a full bench. Use distinct instances to
    // isolate overflow from the automatic three-copy merge rule.
    for (let i = 0; i < ps.hand.length; i++) ps.stow(ps.newPiece('chess', id));
    const hidden = ps.newPiece('chess', id);
    ps.stow(hidden);
    const own = ps.privateView();
    assert.equal(own.stashCount, 1);
    assert.deepEqual(own.stash.map(p => p.uid), [hidden.uid]);
    assert.ok(!own.temp.some(p => p?.uid === hidden.uid), 'equipment row does not show overflow');
    assert.equal(own.canReady, false);
    assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.sell', uid: own.stash[0].uid }), { ok: true });
    assert.equal(ps.privateView().stashCount, 0);
    assert.deepEqual(ps.privateView().stash, []);
    assert.equal(ps.privateView().canReady, true);
  } finally { h.m.dispose(); }
});

test('freeing a bench slot transfers the hidden unit instead of deleting it', () => {
  const h = makeMatch({ mode: 'solo', modeId: 'mode_single_6', data: getVersionData('act3autochess@V3_1') });
  try {
    h.autoHumans().start().runToPhase('PREP', 1);
    const ps = h.m.order[0];
    ps.autoplay = false;
    ps.hand.fill(null); ps.temp.fill(null);
    const id = [...h.m.pool.entries.keys()].find((key) => ps.gd.chess(key)?.visible);
    for (let i = 0; i < ps.hand.length; i++) ps.stow(ps.newPiece('chess', id));
    const hidden = ps.newPiece('chess', id);
    ps.stow(hidden);
    assert.equal(ps.privateView().stashCount, 1);
    assert.deepEqual(ps.sell(ps.hand[0].uid), { ok: true });
    assert.ok(ps.hand.some(p => p?.uid === hidden.uid));
    assert.equal(ps.privateView().stashCount, 0);
  } finally { h.m.dispose(); }
});
