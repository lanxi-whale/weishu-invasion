import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeLive, readLive } from '../bridge/live.js';
import { MatchCombat } from '../game/server/match/match/combat.js';
import { MatchSettle } from '../game/server/match/match/settle.js';
import { applyOpsWave, previewOf } from '../game_ops/server/match/waves.js';
import { groupEnemies } from '../game_ops/public/js/ui/gameLogic/enemies.js';
import { FieldRunner } from '../game_ops/server/match/fields.js';
import { MatchWatch } from '../game_ops/server/match/match/watch.js';
import { Battle } from '../game_ops/server/sim/Battle.js';
import { DataSource } from '../game_ops/server/sim/simdata.js';
import { getVersionData } from '../game_ops/server/data.js';
import * as protocol from '../game_ops/shared/protocol.js';

test('official m04 originium changes combat stats and HP in both streamed and reconnect inspection', () => {
  const b = new Battle({
    seed: 1, stageId: 'act3autochess_m04', kind: 'normal', modeId: 'mode_single_6', round: 1,
    fieldId: 'n:ops', timeLimit: 30, autoFinish: false, content: 'full',
    data: new DataSource(getVersionData('act3autochess@V3_1')),
    players: [{ playerId: 'ops', units: [{ uid: 1, chessId: 'chess_char_1_01_a', row: 11, col: 6 }] }],
  });
  b.start();
  while (b.time < 3.2) b.step();
  const op = b.allyUnits.find((u) => u.uid === 1);
  assert.equal(op.stats.taken, 210);
  assert.equal(op.s.atk, op.base.atk * 1.2);
  assert.equal(op.s.aspd, 120);
  const field = { fieldId: b.fieldId, kind: b.kind, battle: b };
  const messages = [];
  const server = { fields: [field], watchersOf: () => ['watcher'],
    reportError: (_, e) => { throw e; }, sendTo: (_, msg) => messages.push(JSON.parse(JSON.stringify(msg))) };
  const runner = new FieldRunner(server, [field], { onDone() {} });
  runner._emit(field);
  MatchWatch.prototype._sendField.call(server, 'watcher', b.fieldId);
  const frames = messages.filter((msg) => msg.t === 'b.snap');
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    const row = frame.inspect?.find((entry) => entry[0] === op.id);
    assert.ok(row, 'inspection data is in the authoritative frame');
    const live = protocol.readSnapshotUnitStats(row);
    assert.equal(live.hp, Math.round(op.hp));
    assert.equal(live.atk, Math.round(op.s.atk));
    assert.equal(live.interval, Math.round(op.s.interval * 100) / 100);
    assert.equal(live.infection, 300);
    assert.deepEqual(live.range, op.liveRangeGrid);
  }
  assert.equal(b.snapshot().inspect, undefined);
});

test('a ground enemy crossing m04 keeps the originium buff and sourceless true damage after leaving', () => {
  const route = { motion: 'WALK', start: [11, 8], end: [9, 2], checkpoints: [
    { type: 'MOVE', pos: [11, 6] }, { type: 'MOVE', pos: [11, 4] }, { type: 'WAIT', time: 12 },
  ] };
  const battle = new Battle({
    seed: 1, stageId: 'act3autochess_m04', kind: 'normal', modeId: 'mode_single_6', round: 1,
    timeLimit: 30, autoFinish: false, content: 'full', data: new DataSource(getVersionData('act3autochess@V3_1')),
    players: [], routes: [route], spawns: [{ enemyKey: 'enemy_1006_shield', time: 0, routeIndex: 0 }],
  });
  const hits = [];
  battle.on('damageApplied', ({ source, target, dmg, hpRemoved }) => {
    if (target.side === 'enemy') hits.push([source, dmg.type, hpRemoved]);
  });
  battle.step();
  const enemy = battle.enemies[0];
  assert.equal(enemy.findBuff('terrain:infection'), null);
  while (battle.time < 8) battle.step();
  assert.ok(Math.round(enemy.x) < 6);
  assert.equal(enemy.s.atk, 720);
  assert.equal(enemy.s.aspd, 120);
  assert.ok(enemy.findBuff('terrain:infection').timeLeft > 290);
  assert.ok(hits.length >= 3);
  for (const hit of hits) assert.deepEqual(hit, [null, 'true', 70]);
});

test('preview retains gates, batches and timings across bridge and UI grouping', () => {
  const wave = applyOpsWave({ routes: [] }, { sourceId: 'round', spawns: [
    { enemyKey: 'a', batch: 1, time: 1.2, preview: { gate: 'upper' } },
    { enemyKey: 'a', batch: 2, time: 3.15, preview: { gate: 'lower' } },
  ] });
  assert.equal(wave.sourceId, 'round');
  const rows = groupEnemies(previewOf(wave.spawns));
  assert.deepEqual(rows.map(({ gate, batch, time, count }) => ({ gate, batch, time, count })), [
    { gate: 'upper', batch: 1, time: 1.2, count: 1 },
    { gate: 'lower', batch: 2, time: 3.15, count: 1 },
  ]);
});

test('cross-process journal streams actual opponent frames, ignores other streams, settles on end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-live-'));
  const previous = process.env.SP_LIVE_DIR;
  process.env.SP_LIVE_DIR = dir;
  try {
    const sent = [], callbacks = [];
    let settled = 0;
    const ps = { playerId: 'monster', connected: true };
    const m = { round: 1, _liveSession: 'test', watchers: new Map(), markPublic() {}, flush() {},
      _viewers: () => [ps], sendTo: (pid, msg) => sent.push(msg),
      _creditInvasionBounties: MatchSettle.prototype._creditInvasionBounties,
      later: (ms, fn) => callbacks.push(fn), settle: () => { settled++; m.phase = 'SETTLE'; } };
    MatchCombat.prototype._startLiveWatch.call(m);
    assert.equal(sent.length, 1, 'switch to opponent map immediately while waiting');
    assert.equal(sent[0].stageId, 'act3autochess_ops01');
    assert.deepEqual(sent[0].units, []);
    sent.length = 0;
    assert.equal(settled, 0);
    const packet = { stream: 'ops', meta: { fieldId: 'n:ops', units: [{ id: 'operator' }] },
      snap: { t: 'b.snap', fieldId: 'n:ops', gt: 5, killed: 3, inspect: [[1, 50, [100, 20, 4, 0, 1.2, 2, 0]]] },
      ev: { t: 'b.ev', fieldId: 'n:ops', ev: [['attack']] } };
    writeLive('unrelated', packet);
    writeLive('test:1', packet);
    callbacks.shift()();
    assert.deepEqual(sent.map((p) => p.t), ['m.field', 'b.ev', 'b.snap']);
    assert.equal(sent[0].units[0].id, 'operator');
    assert.equal(sent[2].killed, 3);
    assert.deepEqual(sent[2].inspect, packet.snap.inspect);
    const size = sent.length;
    callbacks.shift()();
    assert.equal(sent.length, size, 'frames are not replayed');
    writeLive('test:1', { stream: 'other-room', end: true });
    callbacks.shift()();
    assert.equal(settled, 0);
    writeLive('test:1', { stream: 'ops', end: true });
    callbacks.shift()();
    assert.equal(settled, 1);
    assert.equal(readLive('missing').packets.length, 0);
    assert.ok(readLive('test:1').offset > 0);
  } finally {
    if (previous === undefined) delete process.env.SP_LIVE_DIR;
    else process.env.SP_LIVE_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
