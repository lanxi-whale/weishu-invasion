import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData as OpsData } from '../game_ops/server/match/gamedata.js';
import { GameData as MonsterData } from '../game/server/match/gamedata.js';
import { MatchPrep as OpsPrep } from '../game_ops/server/match/match/prep.js';
import { MatchPrep as MonsterPrep } from '../game/server/match/match/prep.js';
import { MatchSettle as OpsSettle } from '../game_ops/server/match/match/settle.js';
import { MatchSettle as MonsterSettle } from '../game/server/match/match/settle.js';
import { DATA, makeMatch } from '../game_ops/test/match/harness.js';

test('4v4 disables both boss phases in both camps, with 14 ordinary rounds', () => {
  const previous = process.env.OPS_MODE;
  try {
    delete process.env.OPS_MODE;
    for (const Type of [OpsData, MonsterData]) {
      const original = new Type(DATA, 'mode_single_funny');
      assert.ok(original.bossRound > 0, 'standalone original mode still has a boss');
      const monster = new Type({ ...DATA, config: { ...DATA.config, monsterOnly: true } }, 'mode_single_funny');
      assert.equal(monster.bossRound, null);
      assert.equal(monster.hiddenRound, null);
      assert.equal(monster.lastRound, 14);
      process.env.OPS_MODE = '1';
      const ops = new Type(DATA, 'mode_single_funny');
      assert.equal(ops.bossRound, null);
      assert.equal(ops.hiddenRound, null);
      assert.equal(ops.lastRound, 14);
      delete process.env.OPS_MODE;
    }
    for (const Prep of [OpsPrep, MonsterPrep]) {
      let combats = 0;
      const m = { phase: 'PREP', round: 14, gd: { bossRound: null, hiddenRound: null },
        _cancelRehearsal() {}, setDeadline() {}, alivePlayers: () => [],
        startCombat: () => combats++, startFinalAssault: () => assert.fail('boss entered') };
      Prep.prototype.endPrep.call(m);
      assert.equal(combats, 1);
    }
    for (const Settle of [OpsSettle, MonsterSettle]) {
      let outcome;
      const m = { round: 14, gd: { noBossRounds: true, lastRound: 14 },
        alivePlayers: () => [{}], finish: (o) => { outcome = o; },
        startRound: () => assert.fail('round 15 entered') };
      Settle.prototype.afterSettle.call(m);
      assert.equal(outcome.reason, 'completed');
      assert.equal(outcome.victory, true);
      m.alivePlayers = () => [];
      Settle.prototype.afterSettle.call(m);
      assert.equal(outcome.reason, 'eliminated');
    }
  } finally {
    if (previous === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = previous;
  }
});

test('operator final round uses the normal board and reaches RESULT without a boss or round 15', () => {
  const previous = process.env.OPS_MODE;
  process.env.OPS_MODE = '1';
  let h;
  try {
    h = makeMatch({ mode: 'solo', fake: true });
    for (const ps of h.m.alivePlayers()) ps.lp = 100000;
    h.m._startRoundAfterOffers(14);
    assert.ok(h.m.wave);
    assert.equal(h.m.bossWaves, null);
    assert.equal(h.m.publicView().bossId, null);
    assert.equal(h.m.publicView().hiddenRound, null);
    assert.ok(h.drive(() => !!h.ended));
    assert.equal(h.m.phase, 'RESULT');
    assert.equal(h.m.round, 14);
    assert.equal(h.m.outcome.reason, 'completed');
    assert.equal(h.m.hiddenReached, false);
  } finally {
    h?.m.dispose();
    if (previous === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = previous;
  }
});
