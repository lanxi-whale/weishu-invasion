// Private AI economy and board; solo opponents never publish to the shared bridge.
import { getVersionData as opsData } from '../game_ops/server/data.js';
import { getVersionData as monsterData } from '../game/server/data.js';
import { botPrep as opsPrep } from '../game_ops/server/match/bot.js';
import { botPrep as monsterPrep } from '../game/server/match/bot.js';
import { VirtualScheduler } from '../game_ops/server/match/scheduler.js';
import { applyOpsWave } from '../game_ops/server/match/waves.js';
import { invadingLeak } from '../game_ops/server/sim/battle/deploy.js';
import { MatchCombat as MonsterCombat } from '../game/server/match/match/combat.js';
import { matchTypes } from './matchTypes.js';

export class SoloOpponent {
  constructor(owner, camp) {
    // Each camp entry loads both engines. Read the registry at runtime, after the
    // circular module initialization has installed both complete match prototypes.
    const Type = matchTypes[camp];
    if (!Type) throw new Error(`Solo AI engine not loaded: ${camp}`);
    this.prep = camp === 'ops' ? opsPrep : monsterPrep;
    this.scheduler = new VirtualScheduler();
    this.match = new Type({
      mode: 'solo', modeId: owner.modeId, difficulty: owner.difficulty,
      version: owner.version || undefined,
      seed: (owner.seed ^ 0x41a1) >>> 0, data: (camp === 'ops' ? opsData : monsterData)(owner.version || undefined),
      seats: [{ seat: 0, playerId: 'solo_opponent', name: 'AI', isBot: true, connected: true }],
      scheduler: this.scheduler, clientCombat: false, botRehearsal: 0,
      send: () => true, broadcast() {}, onEnd() {},
    });
    // Both camps of this private match use the owner's one map draw. The AI's
    // separate economy seed must not silently pick another battlefield.
    if (this.match.gd.stage(owner.stageId)) {
      this.match.stageId = owner.stageId;
      this.match.stage = this.match.gd.stage(owner.stageId);
    }
    this.match._publishMonsterLineup = () => {};
    this.match.scheduleBotPrep = () => {};
    // Its waves are supplied by the owner, so never construct another opposing AI.
    this.match._pullOpsWaveNow = () => {};
    this.match._monsterLineup = MonsterCombat.prototype._monsterLineup;
    this.match._monsterWavePayload = MonsterCombat.prototype._monsterWavePayload;
    this.round = 0;
  }

  prepare(round) {
    if (this.round === round) return this.match;
    const m = this.match;
    this.scheduler.dispose();
    this.scheduler = new VirtualScheduler();
    m.sched = this.scheduler;
    m._timers.clear();
    if (this.round === 0) {
      // Strategy selection applies opening grants and regulation stock choices.
      // Assigning bandId directly leaves some versions with an empty shop/army.
      m.start();
      const prepared = this.scheduler.runUntil(() => m.phase === 'PREP');
      if (!prepared || m.phase !== 'PREP') throw new Error('Solo AI failed to finish opening choices');
      if (round !== m.round) {
        m._startRoundAfterOffers(round);
        m.enterPrep();
      }
    } else {
      m._startRoundAfterOffers(round);
      m.enterPrep();
    }
    const ps = m.order[0];
    this.prep(m, ps);
    m.dispatch(ps, 'onPrepEnd', { round });
    ps.endPrep();
    this.round = round;
    return m;
  }

  monsterWave(round, base) {
    const m = this.prepare(round);
    return { ...applyOpsWave(base, m._monsterWavePayload(m._monsterLineup()), m.gd), sourceId: null };
  }

  operatorBattle(round, payload) {
    const m = this.prepare(round);
    m.wave = applyOpsWave(m.wave, payload, m.gd);
    return m._normalBattle(m.order[0]);
  }

  /** Settle the private AI defence through the same life and income rules as a solo Alliance player. */
  settleDefense(result) {
    const m = this.match;
    const defender = m.order[0];
    const before = defender.lp;
    const lane = result.perPlayer[defender.playerId];
    m.lastResults = new Map(lane && !result.synthetic ? [[defender.playerId, lane]] : []);
    m.settle(null, null);
    const successfulInvasion = defender.lp < before && (lane?.leaked || []).some(l =>
      l?.goalReached === true && invadingLeak(l, defender.playerId));
    return { opsLp: defender.lp, successfulInvasion };
  }

  dispose() { this.match.dispose(); this.scheduler.dispose(); }
}
