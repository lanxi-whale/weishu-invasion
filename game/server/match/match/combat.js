// server/match/match/combat.js — Match methods: the battles of a normal round — Battle construction (newBattle, the
// spawn list sanitised, a player's normal field after the onBattleStart handlers), the COMBAT phase in both modes
// (server-run streaming, client-side combat), the per-field results and the sim-error log, then 联防 or SETTLE.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { waveFromLineup, rankLineup, enemyKeyOfChess, gateEntryTime, allianceSpawnSchedule, publishWave, MONSTER_GATES, OPS_STAGE_ID, OPS_RECT } from '../monsterWave.js';
import { monsterSpawnInterval, sizeMonsterLineup } from '../monsterUnits.js';
import { boostInvasionStats, scaleInvasionRound } from '../monsterBonuses.js';
import { applyInvasionOrders } from '../invasionWave.js';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readLive } from '../../../../bridge/live.js';
import { duelSource, invasionBountyWinners, waitForDuel, writeDuel } from '../../../../bridge/duel.js';
import { receiveDuelFormations } from '../../../../bridge/duelFormations.js';
import { SoloOpponent } from '../../../../bridge/soloOpponent.js';
import { PHASE, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { withBounties, isFlyKey, classOf } from '../waves.js';
import { planUnite } from '../unite.js';
import { FieldRunner, DeadBattle } from '../fields.js';
import { DELAYS } from './common.js';
import { previewPlayer } from '../preview.js';
import { morphBattleOpt } from '../../../shared/plugins/rules.js';
import { reconcileCommandChests } from '../bandCommands.js';

export class MatchCombat {
  /** Construct a battle; a constructor failure yields a finished stand-in (clean result) and is logged. */
  newBattle(opts, { preview = false } = {}) {
    const full = { resourceNumbers: !preview, data: this.ds, content: this.battleContent, logger: this.log, ...opts, ...morphBattleOpt(this.rules),
      ...(preview ? { logger: {}, quiet: true } : {}) };
    try {
      return new this.BattleClass(full);
    } catch (e) {
      if (!preview) this.reportError(`battle ${opts.fieldId} construct`, e);
      return new DeadBattle(full, 'forced');
    }
  }

  /**
   * Spawn list of a field after the onBattleStart handlers (which may edit `ev.spawns`): malformed entries are dropped
   * and a kill bounty is copied into `mods.bountyCoins`, so a leaked bounty enemy keeps paying its killer in 联防.
   */
  _sanitizeSpawns(list, ownerPlayerId = null) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || typeof s !== 'object' || typeof s.enemyKey !== 'string' || !this.gd.enemy(s.enemyKey)) continue;
      const spec = { ...s, mods: s.mods && typeof s.mods === 'object' ? { ...s.mods } : {} };
      if (ownerPlayerId && spec.ownerPlayerId == null) spec.ownerPlayerId = ownerPlayerId;
      const coins = spec.bounty && typeof spec.bounty === 'object' ? Math.trunc(Number(spec.bounty.coins) || 0) : 0;
      if (coins > 0 && spec.mods.bountyId == null && spec.mods.bountyCoins == null) spec.mods.bountyCoins = coins;
      out.push(spec);
    }
    return out;
  }

  _normalBattle(ps) { return this.newBattle(this._normalOpts(ps)); }

  /** Battle options of a player's normal field (after the onBattleStart handlers). */
  _normalOpts(ps, { preview = false, board = ps.board } = {}) {
    const wave = preview ? structuredClone(this.wave) : this.wave;
    if (preview) ps = previewPlayer(ps, board);
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    // 怪物方不参战：干员战场上没有己方单位，只有送过去的怪在走
    if (this.gd.config && this.gd.config.monsterOnly === true && input && Array.isArray(input.units)) input.units = [];
    // the client's list: bounty units inserted among their host action's own units, which are re-timed around them
    const spawns = withBounties(this.gd, this.round, wave, ps.bounties, ps.playerId).map((s) => ({ ...s, ownerPlayerId: ps.playerId }));
    // `waveSpawns`: the round's own wave before this player's bounties (a copy), so a draw every player shares picks the
    // same units; `routes`: their lanes (鸭爵, GitHub #839)
    const waveSpawns = (wave.spawns || []).map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    const ev = { input, kind: 'normal', round: this.round, spawns, waveSpawns, routes: wave.routes, ...(preview ? { preview: true } : {}) };
    // Preview construction failures go to the rehearsal's discard path, never Match.dispatch's live error sink.
    if (preview) this.dispatcher.dispatch(ps, 'onBattleStart', ev);
    else this.dispatch(ps, 'onBattleStart', ev);
    return {
      seed: deriveSeed(this.seed, `n:${this.round}:${ps.seat}`),
      kind: 'normal',
      modeId: this.modeId,
      round: this.round,
      // 4v4 怪物阵营：自己的战斗只是「看干员那边怎么打」，所以直接跑在干员战场上
      stageId: this.gd.config && this.gd.config.monsterOnly === true ? `arena_${this.stageId}` : this.stageId,
      rect: this.gd.config && this.gd.config.monsterOnly === true ? { ...OPS_RECT } : { ...GEO.NORMAL_RECT },
      timeLimit: wave.timeLimit,
      players: [ev.input && typeof ev.input === 'object' ? ev.input : input],
      spawns: this._sanitizeSpawns(Array.isArray(ev.spawns) ? ev.spawns : spawns, ps.playerId),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: true, ...this.gd.dp },
      fieldId: `n:${ps.playerId}`,
      enemyOverrides: wave.overrides,
      waveId: wave.templateId,
    };
  }

  /** 4v4 怪物阵营：开打前用玩家在 pen 上摆的阵容重算当轮波次 */
  /** 4v4 怪物阵营：棋盘上的阵容（只取真正站在棋盘上的棋子） */
  _monsterLineup(seat = null) {
    const lineup = [];
    for (const ps of this.alivePlayers()) {
      if (seat !== null && ps.seat !== seat) continue;
      if (!ps.board) continue;
      const stats = this._unitBattleStatsOf(ps);
      const strategy = this.gd.band(ps.bandId)?.invasionStrategy?.kind;
      for (const [key, piece] of ps.board) {
        if (!piece || piece.kind !== 'chess' || typeof piece.id !== 'string') continue;
        const [r, c] = String(key).split(',').map(Number);
        if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
        lineup.push({ r, c, chessId: piece.id, uid: piece.uid, sourcePlayerId: ps.playerId,
          stats: boostInvasionStats(ps, stats.get(piece.uid) || this.gd.chess(piece.id)?.stats),
          extraMembers: piece.invasionExtraMembers, strategy });
      }
    }
    return lineup;
  }

  /**
   * 阵容 → 波次负载：按到最近红门的距离分批，每只怪带上它该走的门（upper/lower）与 2★ 的原生 _2 变体。
   */
  _baseMonsterSpawns(lineup) {
    const gates = MONSTER_GATES.map(([r, c]) => ({ r, c }));
    const ranked = sizeMonsterLineup(rankLineup(lineup, gates), this.gd, this.disabledBonds);
    const spawns = [];
    for (const p of ranked) {
      const rec = this.gd.chess(p.chessId);
      const enemyKey = enemyKeyOfChess(p.chessId, this.gd);
      if (!enemyKey) continue;
      const enemy = this.gd.enemy(enemyKey);
      const fly = isFlyKey(this.gd, enemyKey);
      const gate = gates[p.gateIndex];
      const stats = scaleInvasionRound(p.stats || rec?.stats, this.round);
      const mods = { hpMul: 1, atkMul: 1, speedMul: 1, slot: classOf(this.gd, enemyKey) };
      spawns.push({
        time: gateEntryTime(p.dist, stats.moveSpeed),
        enemyKey, star: p.star, count: p.count, interval: monsterSpawnInterval, batch: p.batch,
        uid: p.uid, tier: rec?.tier ?? 0, attackType: enemy?.applyWay,
        // Per-piece stats include synthetic stars and preparation attribute bonuses.
        // Keep enemyKey for the official behaviour; never rederive stats from that key.
        stats, sourcePlayerId: p.sourcePlayerId ?? null, invasionBonds: p.invasionBonds,
        preview: { gate: p.gateIndex === 0 ? 'upper' : 'lower', start: [gate.r, gate.c], fly, elite: enemy?.rank === 'ELITE', boss: false },
        mods,
      });
    }
    return spawns;
  }

  _monsterWavePayload(lineup) {
    const entries = applyInvasionOrders(this, this._baseMonsterSpawns(lineup));
    const spawns = allianceSpawnSchedule(entries, this.gd.combatTimeScale);
    return {
      sourceId: `${this._liveSession ||= randomUUID()}:${this.round}`, round: this.round, at: Date.now(), timeLimit: this.wave ? this.wave.timeLimit : 90,
      routes: this.wave ? this.wave.routes : [], spawns,
    };
  }

  /**
   * 摆怪时就把阵容播出去（干员方在开打那一刻取最新的一份）：只在备战/战斗阶段、阵容真的变了才重新发。
   * 由 markPublic() 顺带调用（节流 500ms）。
   */
  _publishMonsterLineup(force = false) {
    if (this.opts?.duel) return;
    if (!(this.gd.config && this.gd.config.monsterOnly === true)) return;
    if (this.isSolo) return;
    if (this.phase !== PHASE.PREP && this.phase !== PHASE.COMBAT) return;
    const now = Date.now();
    if (!force && this._pubLineupAt && now - this._pubLineupAt < 500) return;
    const lineup = this._monsterLineup();
    // 备战期间空棋盘 = 还没摆，不要把干员方上一份波次冲成空波（开战时才允许发空波：这轮就是没怪）
    if (!force && !lineup.length) return;
    const sig = JSON.stringify(lineup);
    if (!force && sig === this._pubLineupSig) return;
    this._pubLineupAt = now;
    this._pubLineupSig = sig;
    publishWave(this._monsterWavePayload(lineup));
  }

  /**
   * 4v4 怪物阵营：开战时把棋盘上的阵容写进共享的波次（进程内总线 + 文件），自己不打仗。
   * 同时把同一批怪放进自己的战斗里当观战（只走不打，因为没有己方单位）。
   */
  _monsterWaveFromBoards() {
    const LOG = new URL('../../../monster-wave.log', import.meta.url);
    try {
      const lineup = this._monsterLineup();
      const payload = publishWave(this._monsterWavePayload(lineup));
      if (this.wave) this.wave = waveFromLineup(this.wave, lineup, this.gd, this.disabledBonds);
      fs.appendFileSync(LOG, `[W] R${this.round} 提交 ${payload.spawns.reduce((sum, spawn) => sum + spawn.count, 0)} 只：` +
        payload.spawns.map((x) => `${x.enemyKey}@${x.preview.gate}`).join(' ') + '\n');
    } catch (e) {
      try { fs.appendFileSync(LOG, '[W] ERR ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) + '\n'); } catch { /* ignore */ }
    }
  }

  startCombat() {
    if (this.opts?.duel) { this._startDuelCombat(); return; }
    if (this.gd.config && this.gd.config.monsterOnly === true) {
      if (this.isSolo) { this._startSoloOpponent(); return; }
      this._monsterWaveFromBoards();
      this._startLiveWatch();
      return;
    }
    if (this.clientCombat) { this._startCombatClient(); return; }
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    this.lastResults = new Map();
    this.fields = alive.map((ps) => ({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], battle: this._normalBattle(ps), live: true }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, { onDone: (runner) => this.combatDone(runner) });
    this.runner.start();
  }

  // Wait for the opponent's authoritative field; never simulate an empty replay.
  _startSoloOpponent() {
    this._soloOpponent ||= new SoloOpponent(this, 'ops');
    const battle = this._soloOpponent.operatorBattle(this.round, this._monsterWavePayload(this._monsterLineup()));
    const defender = this._soloOpponent.match?.order[0];
    if (defender) this._duelPool = { ops: defender.lp };
    // Keep the real operator battlefield metadata: its geometry, devices and
    // deployment coordinates must agree with what the spectator renders.
    this.phase = PHASE.COMBAT;
    this.lastResults = new Map();
    this.watchers.clear();
    const players = this.alivePlayers().map((ps) => ps.playerId);
    this.fields = [{ fieldId: battle.fieldId, kind: 'normal', players, battle, live: true }];
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, { onDone: (runner) => {
      const field = this.fields[0];
      field.live = false;
      const result = runner.resultOf(field);
      if (defender) {
        const { opsLp, successfulInvasion } = this._soloOpponent.settleDefense(result);
        this._duelPool = { ops: opsLp };
        if (opsLp > 0 && this.round < this.gd.lastRound) this._creditInvasionSuccess(successfulInvasion);
      }
      this._creditInvasionBounties(invasionBountyWinners(Object.values(result.perPlayer)));
      this.settle(null, null);
    } });
    this.runner.start();
  }

  _startLiveWatch() {
    this.phase = PHASE.COMBAT;
    this.fields = [];
    this.lastResults = new Map();
    this.watchers.clear();
    this.deadline = 0;
    this._liveWatchView = null;
    this._liveWatchMeta = { fieldId: `live:${this.round}`, kind: 'normal', stageId: this.stageId || OPS_STAGE_ID, rect: { ...OPS_RECT }, units: [], live: true };
    this.markPublic();
    this.flush(true);
    for (const ps of this._viewers()) {
      if (ps.connected) this.sendTo(ps.playerId, { t: 'm.field', ...this._liveWatchMeta });
    }
    this.markPublic();
    const sourceId = `${this._liveSession}:${this.round}`;
    let offset = 0, stream = null, fieldId = null;
    let lastAt = Date.now();
    const poll = () => {
      if (this.disposed || this.phase !== PHASE.COMBAT) return;
      const result = readLive(sourceId, offset);
      offset = result.offset;
      for (const p of result.packets) {
        if (stream && stream !== p.stream) continue;
        stream ||= p.stream;
        lastAt = Date.now();
        if (p.end) {
          this._creditInvasionBounties(p.invasionBountyWinners);
          this.settle(null, null);
          return;
        }
        fieldId ||= p.meta.fieldId;
        if (p.meta.fieldId !== fieldId) continue;
        this._liveWatchView = p;
        this._liveWatchMeta = p.meta;
        this.markPublic();
        for (const ps of this._viewers()) {
          if (!ps.connected) continue;
          if (ps._liveStream !== stream) {
            ps._liveStream = stream;
            this.sendTo(ps.playerId, { t: 'm.field', ...p.meta, live: true });
          }
          if (p.ev) this.sendTo(ps.playerId, p.ev);
          if (p.snap) this.sendTo(ps.playerId, p.snap);
        }
      }
      if (Date.now() - lastAt > 120000) { this.settle(null, null); return; }
      this.later(100, poll);
    };
    poll();
  }

  _startDuelCombat() {
    const duel = this.opts.duel;
    const round = this.round;
    const spawns = Array.from({ length: 4 }, (_, seat) => this._monsterWavePayload(this._monsterLineup(seat)).spawns);
    writeDuel(duel, `round-${round}-lineups`, { spawns });
    waitForDuel(this, `round-${round}-start`, ({ pool }) => {
      receiveDuelFormations(this, 'monster');
      this._duelPool = pool;
      this.phase = PHASE.COMBAT;
      this.fields = [];
      this.lastResults = new Map();
      this.watchers.clear();
      this._duelLive = new Map();
      this.markPublic();
      const streams = [0, 1, 2, 3, 'unite'].map(seat => ({ seat, source: duelSource(duel, round, seat), offset: 0 }));
      const receiveStreams = () => {
        for (const stream of streams) {
          const joint = stream.seat === 'unite';
          const journal = readLive(stream.source, stream.offset, duel.directory);
          stream.offset = journal.offset;
          for (const packet of journal.packets) {
            if (!packet.meta) continue;
            this._duelLive.set(stream.seat, packet);
            // Keep terminal counts from late lane packets during the joint battle.
            if (!joint && this.phase === PHASE.UNITE) continue;
            if (Number.isFinite(packet.deadline)) this.deadline = packet.deadline;
            if (joint && this.phase !== PHASE.UNITE) {
              this.phase = PHASE.UNITE;
              this.flush(true);
            }
            for (const ps of this._viewers()) {
              if (!ps.connected || (!joint && this._duelWatchSeat(ps) !== stream.seat)) continue;
              if (ps._liveField !== packet.meta.fieldId || ps._liveStream !== packet.stream) {
                this._sendDuelField(ps, packet);
              }
              if (packet.ev) this.sendTo(ps.playerId, packet.ev);
              if (packet.snap) this.sendTo(ps.playerId, packet.snap);
            }
          }
          if (journal.packets.length) this.markPublic();
        }
      };
      const pollStreams = () => {
        if (this.disposed || this.ended || this.round !== round || (this.phase !== PHASE.COMBAT && this.phase !== PHASE.UNITE)) return;
        receiveStreams();
        this.later(100, pollStreams);
      };
      pollStreams();
      waitForDuel(this, `round-${round}-result`, result => {
        receiveStreams();
        this._duelResult = result;
        this._duelPool = result.pool;
        this.settle(null, null);
      });
    });
  }

  _startCombatClient() {
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    this.lastResults = new Map();
    this.watchers.clear();
    const fields = alive.map((ps) => this._ccField({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], opts: this._normalOpts(ps) }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._launch(fields);
    // every fighting human runs its own field; eliminated humans (and spectator seats) keep watching (research 09 §3.1
    // "Keep-watching auto-observes the first available field", switching freely with 前往查看): a replica of the field
    // of the player they follow — the one they last watched, else the first player still in (item 56) — else the first
    for (const f of fields) for (const pid of f.players) {
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left) continue;
      this.watchers.set(pid, f.fieldId);
      this._sendStart(pid, f);
    }
    const first = fields.find((f) => f.mode === 'client') || fields[0] || null;
    if (first) {
      for (const ps of this._viewers()) {
        if (ps.alive || this.watchers.has(ps.playerId)) continue;
        const f = this._watchTargetField(ps, fields) || first;
        this.watchers.set(ps.playerId, f.fieldId);
        this._sendStart(ps.playerId, f, { watch: true });
      }
    }
    this.markPublic();
  }

  /** Aggregate a finished field's content/engine errors (battle.errors: unique records) for diagnostics. */
  _collectSimErrors(f, res) {
    this.simErrors += Number(res && res.errors) || 0;
    const list = f && f.battle && Array.isArray(f.battle.errors) ? f.battle.errors : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const key = `${e.label}|${e.who || ''}|${e.message}`;
      let rec = this.simErrorLog.get(key);
      if (!rec) {
        if (this.simErrorLog.size >= 500) continue;
        rec = { label: String(e.label), who: String(e.who || ''), message: String(e.message), stack: e.stack ? String(e.stack) : null, battles: 0, count: 0 };
        this.simErrorLog.set(key, rec);
      }
      rec.battles++;
      rec.count++;
    }
  }

  combatDone(runner) { this._finishCombat((f) => runner.resultOf(f)); }

  /** Every normal field has its result: record them, then 联防 or SETTLE. */
  _finishCombat(resultOf) {
    if (this.phase !== PHASE.COMBAT) return;
    this._stopClientCombat();
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        this.lastResults.set(pid, pp || { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, unitsEnd: [], unitStats: [] });
        // the views show the layers the battle reached until settle() makes them persistent (DESIGN §20.15)
        const ps = this.players.get(pid);
        if (ps) reconcileCommandChests(ps, pp);
        const gains = pp && pp.layerGains && typeof pp.layerGains === 'object' ? pp.layerGains : null;
        if (ps && gains && Object.keys(gains).length) { ps.pendingLayerGains = { ...gains }; ps.dirty(); }
      }
    }
    for (const f of this.fields) f.live = false;
    this.deadline = 0;
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterCombat());
  }

  /**
   * After the COMBAT_END pause: 联防 or SETTLE. The plan is made now, from the players still in — a player who quit
   * during the last field or the pause (中途退出 = eliminated, board cleared) is neither a helper nor a leaker whose
   * enemies re-enter.
   */
  _afterCombat() {
    if (this.phase !== PHASE.COMBAT) return;
    const plan = planUnite(this, this.lastResults);
    if (plan) this.startUnite(plan);
    else this.settle(null, null);
  }
}

