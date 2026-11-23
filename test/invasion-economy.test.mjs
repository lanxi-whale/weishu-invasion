import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDuel, readDuel, removeDuel } from '../bridge/duel.js';
import { getVersionData } from '../game/server/data.js';
import { makeMatch } from '../game/test/match/harness.js';
import { getVersionData as getDefenseData } from '../game_ops/server/data.js';
import { applyOpsWave } from '../game_ops/server/match/waves.js';
import { makeMatch as makeDefenseMatch } from '../game_ops/test/match/harness.js';

const version = 'act3autochess@V3_1';
const raw = getVersionData(version);

function invasionPrep(t, band, mode = 'coop') {
  const h = makeMatch({ mode, modeId: mode === 'solo' ? 'mode_single_6' : 'mode_multi_normal', humans: 1, data: raw });
  t.after(() => h.m.dispose());
  h.start().toPrep(1, { band });
  return { m: h.m, p: h.ps('p_0') };
}

function startRound(p, round) {
  p.m.round = round;
  p.startRound(round);
}

test('directed supply spends its temporary charge first and rolls the highest unlocked tier', t => {
  const { m, p } = invasionPrep(t, 'band_price');
  assert.equal(p.privateView().shop.freeRefreshes, 0);
  p.shop.level = 2;
  const highest = [...m.pool.entries].filter(([id, entry]) => entry.tier === 2 && p.gd.shopCanRollChess(id, 2, 2));
  assert.ok(highest.length > 0);
  p.shop.freeRefreshes = 2;
  startRound(p, 2);
  assert.equal(p.privateView().shop.freeRefreshes, 3);
  p.funds = 0;
  assert.ok(m.handle(p.playerId, { t: 'g.refresh' }).ok);
  assert.equal(p.funds, 0);
  assert.equal(p.gd.tierOf(p.shop.slots[0].id), 2);
  assert.equal(p.privateView().shop.freeRefreshes, 2);

  startRound(p, 4);
  assert.equal(p.privateView().shop.freeRefreshes, 3);
  startRound(p, 5);
  assert.equal(p.privateView().shop.freeRefreshes, 2);

  for (const [id, entry] of m.pool.entries) if (entry.tier === 2) m.pool.take(id, entry.left);
  startRound(p, 6);
  assert.ok(m.handle(p.playerId, { t: 'g.refresh' }).ok);
  assert.equal(p.gd.tierOf(p.shop.slots[0].id), 1);
  assert.equal(p.privateView().shop.freeRefreshes, 2);
});

test('independent invasion simulation credits the same siege bounty from its AI opponent field', t => {
  const { m, p } = invasionPrep(t, 'band_smith', 'solo');
  m.round = 5;
  m._soloOpponent = { operatorBattle: () => ({
    fieldId: 'n:solo_opponent',
    finished: true,
    result: () => ({ perPlayer: { solo_opponent: { leaked: [
      { sourcePlayerId: p.playerId, invasionSiegeBounty: true },
    ] } } }),
  }), dispose() {} };
  m.startCombat();
  assert.equal(p.pendingFunds, 2);
});

test('the first two eligible natural merges retain their additional monster until sale', t => {
  const { m, p } = invasionPrep(t, 'band_evolve');
  const ids = [...m.pool.entries.keys()].filter(id => p.gd.goldenIdOf(id));
  const high = ids.find(id => p.gd.tierOf(id) >= 5);
  const [first, second, third] = ids.filter(id => p.gd.tierOf(id) <= 4);
  const merge = (id, extra = 0) => {
    assert.ok(id);
    assert.ok(p.acquireChess(id));
    assert.ok(p.acquireChess(id));
    p.nextInvasionExtraMembers = extra;
    const piece = p.acquireChess(id, { source: 'buy' });
    assert.equal(piece.id, p.gd.goldenIdOf(id));
    return piece;
  };
  assert.equal(merge(high).invasionExtraMembers ?? 0, 0);
  const reinforced = merge(first, 1);
  assert.equal(reinforced.invasionExtraMembers, 2);
  assert.ok(p.sell(reinforced.uid).ok);
  startRound(p, 2);
  assert.equal(merge(second).invasionExtraMembers, 1);
  assert.equal(merge(third).invasionExtraMembers ?? 0, 0);
});

test('siege bounty pays once next round for a deployed high-tier monster that reaches the normal goal', t => {
  const { m: invasion, p } = invasionPrep(t, 'band_smith');
  const h = makeDefenseMatch({ mode: 'coop', seats: [{ seat: 0, playerId: 'defender', name: 'Defender', connected: true }],
    data: getDefenseData(version) });
  const defense = h.m;
  const duel = createDuel();
  t.after(() => { defense.dispose(); removeDuel(duel); });
  invasion.opts.duel = duel;
  defense.opts.duel = duel;
  const receiver = defense.order[0];
  const high = [...invasion.pool.entries.keys()].find(id => p.gd.tierOf(id) >= 5);
  const low = [...invasion.pool.entries.keys()].find(id => p.gd.tierOf(id) < 5);
  const entries = [[high, '16,8'], [low, '13,8']];
  p.board = new Map(entries.map(([id, pos], i) => [pos, { uid: 100 + i, id, kind: 'chess', items: [] }]));
  p.recompute();

  function run(round, outcome) {
    invasion.round = defense.round = round;
    defense.phase = 'COMBAT';
    receiver.lp = 100;
    p.pendingFunds = 0;
    const wave = invasion._monsterWavePayload(invasion._monsterLineup());
    const routes = entries.map(([, pos]) => {
      const row = Number(pos.split(',')[0]);
      const start = row === 16 ? [12, 10] : [9, 10];
      return { motion: 'WALK', start, end: start, steps: [{ t: 'wait', s: 60 }] };
    });
    const received = applyOpsWave({ routes }, JSON.parse(JSON.stringify(wave)), defense.gd);
    const batt = defense.newBattle({ round, kind: 'normal', seed: 1, stageId: 'act3autochess_m04',
      timeLimit: 20, flags: { duelGateLeaks: true }, players: [{ playerId: receiver.playerId, units: [], bonds: {} }],
      routes: received.routes, spawns: received.spawns.map(s => ({ ...s, time: 0, interval: 0 })) });
    batt.step();
    const highEnemy = received.spawns.find(s => s.preview.gate === 'upper').enemyKey;
    for (const enemy of batt.enemies.filter(e => e.defId !== highEnemy)) batt.leak(enemy);
    if (outcome === 'through') {
      for (const enemy of batt.enemies.filter(e => e.defId === highEnemy)) batt.leak(enemy);
    } else if (outcome === 'offspring') {
      const parent = batt.enemies.find(e => e.defId === highEnemy);
      batt.leak(batt.spawnEnemy(parent.defId, { sourcePlayerId: parent.sourcePlayerId, mods: parent.mods }));
    }
    batt.forceEnd('timeout');
    const result = batt.result().perPlayer[receiver.playerId];
    assert.ok(result.leaked.some(l => l.goalReached === true));
    defense.lastResults = new Map([[receiver.playerId, result]]);
    defense.settle(null, null);
    invasion._duelResult = readDuel(duel, `round-${round}-result`);
    invasion.settle(null, null);
    return p.pendingFunds;
  }

  assert.equal(run(4, 'through'), 1);
  assert.equal(run(5, 'timeout'), 1);
  assert.equal(run(6, 'offspring'), 1);
  assert.equal(run(7, 'through'), 3, 'the team reward stacks with the siege bounty');
  invasion.settle(null, null);
  assert.equal(p.pendingFunds, 3);
  p.funds = 0;
  startRound(p, 8);
  assert.equal(p.funds, p.gd.income(8) + 3);
  assert.equal(p.pendingFunds, 0);
});
