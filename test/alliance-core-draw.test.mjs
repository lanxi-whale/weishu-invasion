import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../game_ops/server/data.js';
import { GameData } from '../game_ops/server/match/gamedata.js';
import { drawDisabledBonds } from '../game_ops/server/match/pool.js';
import { thresholdsOf } from '../game_ops/server/match/bondsMeta.js';
import { canPlace, placeClass } from '../game_ops/server/match/board.js';
import { createRng } from '../game_ops/server/sim/rng.js';
import { setGameData } from '../game_ops/server/sim/content/support/index.js';
import { makeMatch } from '../game_ops/test/match/harness.js';
import { matchInfoModel, MatchBondRow } from '../game_ops/public/js/ui/matchInfo.js';
import { BondDisc } from '../game_ops/public/js/ui/components.js';
import { modeOffBonds } from '../game_ops/public/js/ui/gameLogic/bonds.js';

const VERSION = 'act3autochess@V3_1';
const raw = getVersionData(VERSION);

function* descendants(node) {
  if (Array.isArray(node)) {
    for (const child of node) yield* descendants(child);
  } else if (node && typeof node === 'object') {
    yield node;
    yield* descendants(node.props?.children);
  }
}

function enableAlliance(t) {
  const previous = process.env.OPS_MODE;
  process.env.OPS_MODE = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = previous;
  });
}

test('the alliance randomly enables five core bonds in each playable mode', (t) => {
  enableAlliance(t);
  for (const version of [undefined, 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1', VERSION]) {
    const data = getVersionData(version);
    for (const mode of Object.values(data.config.modes).filter(m => ['SINGLE', 'MULTI'].includes(m.type))) {
      const gd = new GameData(data, mode.modeId);
      const cores = Object.values(data.bonds).filter(b => b.isCore).map(b => b.bondId);
      if (version === VERSION) assert.equal(cores.length, 10);
      const results = new Set();
      const availableAcrossSeeds = new Set();
      for (let seed = 1; seed <= 12; seed++) {
        const draw = drawDisabledBonds(gd, createRng(seed));
        assert.equal(draw.choice, undefined, mode.modeId);
        const off = new Set([...draw.drawn, ...draw.staticOff]);
        const active = gd.bondIds.filter(id => gd.bond(id).isCore && !off.has(id));
        assert.equal(active.length, 5, `${version} ${mode.modeId}`);
        assert.deepEqual(draw, drawDisabledBonds(gd, createRng(seed)), 'the same seed gives the same draw');
        results.add(active.join());
        for (const id of active) availableAcrossSeeds.add(id);
      }
      assert.deepEqual([...availableAcrossSeeds].sort(), cores.sort(), mode.modeId);
      assert.ok(results.size > 1, mode.modeId);
    }
  }
});

test('any live core keeps a multi-core operator and a live add-on cannot rescue every disabled core', (t) => {
  enableAlliance(t);
  const gd = new GameData(raw, 'mode_multi_funny');
  const record = gd.visibleChess.map(id => gd.chess(id)).find(rec => rec.name === '卡涅利安');
  const [first, second] = record.bonds.filter(id => gd.bond(id).isCore);
  const [addon] = record.bonds.filter(id => !gd.bond(id).isCore);
  assert.equal(gd.bondsExclude(record, new Set([first, addon])), false);
  assert.equal(gd.bondsExclude(record, new Set([first, second])), true);
  assert.equal(gd.bondsExclude({ bonds: [addon] }, new Set([first, second])), false);
  assert.equal(gd.bondsExclude({ bonds: [addon] }, new Set([first, second, addon])), true);
  assert.equal(gd.bondsExclude({ bonds: [] }, new Set([first, second, addon])), false);
});

test('match info and recruitable stock follow the same draw and setup reroll', (t) => {
  enableAlliance(t);
  const h = makeMatch({ mode: 'coop', modeId: 'mode_multi_funny', difficulty: 'FUNNY', data: raw, seed: 1 });
  t.after(() => h.m.dispose());
  h.start();
  const m = h.m;
  function checkDraw() {
    const pub = m.publicView();
    const mode = raw.config.modes[pub.modeId];
    const info = matchInfoModel(pub, { mode, bonds: Object.values(raw.bonds), chess: id => raw.chess[id] });
    assert.equal(info.core.length, 10);
    const active = info.core.filter(b => !info.stateOf(b.bondId)).map(b => b.bondId).sort();
    assert.equal(active.length, 5);
    const tree = MatchBondRow({ title: '', micro: '', bonds: info.core, model: info });
    const discs = [...descendants(tree)].filter(node => node.type === BondDisc);
    assert.equal(discs.filter(node => node.props.active).length, 5);
    assert.equal(discs.filter(node => node.props.disabled && !node.props.cross).length, 5);
    const disabled = new Set(pub.disabledBonds);
    const offInGame = modeOffBonds(mode, pub);
    assert.deepEqual([...offInGame].sort(), m.staticInactiveBonds);
    for (const id of m.gd.visibleChess) {
      const rec = raw.chess[id];
      const core = rec.bonds.filter(id => m.gd.bond(id)?.isCore);
      const relevant = core.length ? core : rec.bonds;
      const banned = relevant.length > 0 && relevant.every(id => disabled.has(id));
      assert.equal(info.banned.includes(id), banned, id);
      assert.equal(m.chessExcluded(rec), banned, id);
      assert.equal(m.pool.has(id), !banned && m.gd.poolCopies(id) > 0, id);
    }
    return active;
  }
  const initial = checkDraw();
  assert.equal(m.requestSetupReroll('p_0', m.setupRevision).ok, true);
  assert.equal(m.setupRevision, 1);
  assert.notDeepEqual(checkDraw(), initial);
  const banned = m.bannedChess[0];
  assert.ok(banned);
  assert.equal(m.order[0].acquireChess(banned, { fromPool: false }), null);
  const enabled = m.gd.visibleChess.find(id => {
    const cores = raw.chess[id].bonds.filter(bond => m.gd.bond(bond)?.isCore);
    return cores.some(bond => m.disabledBonds.includes(bond)) && cores.some(bond => !m.disabledBonds.includes(bond));
  });
  assert.ok(enabled);
  assert.ok(m.order[0].acquireChess(enabled, { silent: true }));
});

test('an undrawn alliance core activates when its recruitable members reach the threshold', (t) => {
  enableAlliance(t);
  const h = makeMatch({ mode: 'coop', modeId: 'mode_multi_funny', difficulty: 'FUNNY', data: raw, seed: 2 });
  t.after(() => h.m.dispose());
  h.start().toPrep(1, { band: h.m.gd.bandIds()[0] });
  const m = h.m;
  const ps = h.ps('p_0');
  const bondId = 'lethaniaShip';
  assert.ok(m.disabledBonds.includes(bondId));
  const [required] = thresholdsOf(m.gd.bond(bondId));
  const members = [...m.pool.entries.keys()].filter(id => m.gd.chess(id).bonds.includes(bondId));
  assert.equal(members.length, required);

  for (const [i, id] of members.entries()) {
    const piece = ps.acquireChess(id, { silent: true });
    assert.ok(piece, id);
    const map = ps.deployMap();
    const position = placeClass(ps, m.gd.chess(id));
    const tile = [...map.keys()].find(key => {
      const [row, col] = key.split(',').map(Number);
      return !ps.board.has(key) && canPlace(map, position, row, col);
    });
    assert.ok(tile, id);
    const [row, col] = tile.split(',').map(Number);
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: piece.uid, to: { area: 'board', row, col } }), { ok: true });
    assert.equal(ps.bonds[bondId]?.active ?? false, i + 1 === required);
  }

  assert.ok(m.publicView().disabledBonds.includes(bondId), 'the recruitment draw is still in effect');
  const entry = ps.privateView().bonds.find(bond => bond.bondId === bondId);
  assert.equal(entry.count, required);
  assert.equal(entry.active, true);
  assert.ok(!entry.off);
  setGameData(raw);
  t.after(() => setGameData(null));
  const battle = m._normalBattle(ps);
  battle.start();
  assert.ok(battle.allyUnits.some(unit => unit.kind === 'op' && unit.hasBuff('bond:lethania')));

  const member = [...ps.board.values()].find(piece => members.includes(piece.id));
  const idx = ps.hand.findIndex(piece => piece == null);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: member.uid, to: { area: 'hand', idx } }), { ok: true });
  assert.equal(ps.bonds[bondId].count, required - 1);
  assert.equal(ps.bonds[bondId].active, false);
});
