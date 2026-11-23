import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { SoloOpponent } from '../bridge/soloOpponent.js';
import { OPS_RECT } from '../game/server/match/monsterWave.js';
import { makeMatch as opsMatch } from '../game_ops/test/match/harness.js';
import { makeMatch as monsterMatch } from '../game/test/match/harness.js';
import { getVersionData as getMonsterData } from '../game/server/data.js';
import { getVersionData as getOpsData } from '../game_ops/server/data.js';
import { spawnChildren } from '../game_ops/server/sim/content/enemies/helpers.js';

test('each camp alone loads its solo opponent and starts combat through the ready intent', async () => {
  // The combined harness imports above can hide missing registrations. Production
  // hosts load one camp in isolation; each worker has its own ESM module registry.
  for (const camp of ['game', 'game_ops']) {
    const harness = new URL(`../${camp}/test/match/harness.js`, import.meta.url).href;
    const data = new URL(`../${camp}/server/data.js`, import.meta.url).href;
    const code = `
      import assert from 'node:assert/strict';
      import { makeMatch } from ${JSON.stringify(harness)};
      import { getVersionData } from ${JSON.stringify(data)};
      process.env.OPS_MODE = '1';
      for (const version of [null, 'act3autochess@V3_1']) {
        const h = makeMatch({mode:'solo', data:getVersionData(version || undefined),
          modeId:version ? 'mode_single_6' : 'mode_single_normal'});
        h.m.version = version;
        try {
          h.autoHumans().start().runToPhase('PREP', 1);
          const p = h.m.order[0];
          p.autoplay = false;
          p.autoPickCommands();
          p.resolveTemp();
          assert.equal(h.m.handle(p.playerId, {t:'g.ready', ready:true}).ok, true);
          assert.ok(h.run(() => h.m.phase === 'COMBAT'));
          assert.equal(h.m.errorCount, 0, JSON.stringify(h.m.errors));
          assert.ok(h.m._soloOpponent);
          const ai = h.m._soloOpponent.match;
          assert.ok(ai.order[0].board.size > 0, 'AI must field units in this version');
          const battle = h.m.fields[0].battle;
          if (${JSON.stringify(camp)} === 'game') {
            assert.ok(battle.units.some(u => u.side === 'ally'), 'AI defenders enter the battle');
          }
          assert.ok(h.run(() => h.m.phase === 'SETTLE'));
          if (${JSON.stringify(camp)} === 'game') {
            assert.ok(battle.units.some(u => u.side === 'ally' && u.deployed), 'AI defenders actually deploy');
            assert.ok(h.sent.some(([, msg]) => msg.t === 'b.ev' && msg.ev?.some?.(e => e[0] === 'deploy')),
              'deployment events reach the monster spectator');
          }
        } finally { h.m.dispose(); }
      }
    `;
    await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));
      worker.once('error', reject);
      worker.once('exit', (status) => status === 0 ? resolve() : reject(new Error(`${camp}: worker exited ${status}`)));
    });
  }
});

test('solo AI buys and deploys real units in both camps, preserving its board between rounds', () => {
  const previous = process.env.OPS_MODE;
  process.env.OPS_MODE = '1';
  try {
    for (const camp of ['ops', 'monster']) {
      const owner = (camp === 'ops' ? monsterMatch : opsMatch)({ mode: 'solo', seed: 7, modeId: 'mode_single_normal' });
      const ai = new SoloOpponent(owner.m, camp);
      try {
        const m = ai.prepare(1);
        assert.ok(m.order[0].board.size > 0, `${camp} AI deployed a lineup`);
        const first = m.order[0].board;
        assert.equal(ai.prepare(1).order[0].board, first, 'same round does not buy twice');
        ai.prepare(2);
        assert.ok(m.order[0].board.size > 0);
        assert.equal(m.round, 2);
        assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
        if (camp === 'monster') {
          const wave = ai.monsterWave(2, { routes: [] });
          assert.ok(wave.spawns.length > 0);
          assert.equal(wave.sourceId, null, 'private solo wave never starts a shared stream');
          assert.ok(wave.spawns.every((s) => s.preview.gate && s.lineup.batch));
        } else {
          const battle = ai.operatorBattle(2, { spawns: [{ enemyKey: 'enemy_1001_1', time: 1, preview: { gate: 'upper' } }] });
          assert.ok(battle.units.some((u) => u.side === 'ally'));
          assert.notEqual(battle.constructor.name, 'DeadBattle');
        }
      } finally { ai.dispose(); owner.m.dispose(); }
    }
  } finally {
    if (previous === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = previous;
  }
});

test('渡桥 AI buys and deploys an operator before spending gold on its refresh', () => {
  const version = 'act3autochess@V3_1';
  const h = monsterMatch({ mode: 'solo', seed: 4, modeId: 'mode_single_6', data: getMonsterData(version) });
  h.m.version = version;
  const ai = new SoloOpponent(h.m, 'ops');
  try {
    const [player] = ai.prepare(1).order;
    assert.equal(player.bandId, 'band_high');
    assert.ok(player.deployCount > 0, '渡桥 should field an operator in round one');
  } finally {
    ai.dispose();
    h.m.dispose();
  }
});

test('solo operator gets AI waves during prep without a monster room', () => {
  const previous = process.env.OPS_MODE;
  process.env.OPS_MODE = '1';
  const h = opsMatch({ mode: 'solo', fake: true });
  try {
    h.start().toPrep(1);
    assert.ok(h.m.wave.spawns.length > 0);
    assert.ok(h.m._soloOpponent);
    assert.equal(h.m.wave.sourceId, null);
    assert.ok(h.m.nextEnemiesFor(h.m.order[0]).length > 0);
  } finally {
    h.m.dispose();
    if (previous === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = previous;
  }
});

test('solo monster starts an AI defence immediately and returns to settlement', () => {
  const h = monsterMatch({ mode: 'solo' });
  try {
    h.start().toPrep(1);
    h.m.endPrep();
    assert.equal(h.m.phase, 'COMBAT');
    assert.ok(h.m.fields[0].battle.units.some((u) => u.side === 'ally'), 'AI defenders scheduled for deployment');
    assert.equal(h.m.publicView().liveWaiting, false);
    assert.ok(h.m.fieldOf(h.m.order[0]));
      assert.equal(h.m.fields[0].battle.fieldMeta().stageId, h.m.stageId);
      assert.deepEqual(h.m.fields[0].battle.fieldMeta().rect, OPS_RECT);
      const field = h.sent.filter(([, msg]) => msg.t === 'm.field').at(-1)?.[1];
      assert.equal(field?.stageId, h.m.stageId, 'the client is sent to the selected operator arena');
      assert.deepEqual(field?.rect, OPS_RECT);
    assert.ok(h.run(() => h.m.phase === 'SETTLE'));
    assert.equal(h.m.errorCount, 0, JSON.stringify(h.m.errors));
  } finally { h.m.dispose(); }
});

test('a summon-only breach costs the solo AI life and earns the attacker income next round', () => {
  const version = 'act3autochess@V3_1';
  const h = monsterMatch({ mode: 'solo', modeId: 'mode_single_6', data: getMonsterData(version) });
  try {
    h.m.version = version;
    h.start().toPrep(1, { band: 'band_copy' });
    const m = h.m;
    const [invader] = m.alivePlayers();
    invader.board.clear();
    h.sched.instant = false;
    m.startCombat();
    const [defender] = m._soloOpponent.match.alivePlayers();
    const { battle } = m.fields[0];
    const before = defender.lp;
    assert.ok(before > 1);
    const [child] = spawnChildren(battle,
      { x: 8, y: 12, sourcePlayerId: invader.playerId, ownerId: defender.playerId },
      'enemy_1138_tumor', 1, { countInTotal: false,
        route: { motion: 'WALK', start: [12, 8], end: [12, 8], checkpoints: [] } });
    assert.ok(child);
    battle.leak(child);
    assert.equal(invader.pendingFunds, 0);
    assert.equal(m.publicView().duelPool.ops, before);
    assert.equal(m.publicView().fields[0].gateLeaks, 1);
    battle.forceEnd();
    assert.ok(h.run(() => m.phase === 'SETTLE'));
    assert.equal(defender.lp, before - 1);
    assert.equal(m.publicView().duelPool.ops, before - 1);
    assert.equal(invader.pendingFunds, 1);
    assert.equal(defender.pendingFunds, 0);
    const funds = invader.funds;
    invader.startRound(2);
    assert.equal(invader.funds - funds, invader.gd.income(2) + 1);
    assert.equal(invader.pendingFunds, 0);
  } finally { h.m.dispose(); }
});

test('solo Alliance settlement awards both bonuses when the AI wave is held', () => {
  const version = 'act3autochess@V3_1';
  const before = process.env.OPS_MODE;
  process.env.OPS_MODE = '1';
  const h = opsMatch({ mode: 'solo', modeId: 'mode_single_6', data: getOpsData(version) });
  try {
    h.m.version = version;
    h.autoHumans().start().runToPhase('PREP', 1);
    const [defender] = h.m.alivePlayers();
    const [invader] = h.m._soloOpponent.match.alivePlayers();
    assert.equal(h.m.wave.invasionWave, true);
    h.m.lastResults.set(defender.playerId, { leaked: [] });
    h.m.settle(null, null);
    assert.equal(defender.pendingFunds, 2);
    assert.equal(invader.pendingFunds, 0);
  } finally {
    h.m.dispose();
    if (before === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = before;
  }
});
