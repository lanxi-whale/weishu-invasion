import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Lobby as AllianceLobby } from '../game_ops/server/lobby.js';
import { Lobby as InvasionLobby } from '../game/server/lobby.js';
import { SessionRegistry } from '../game_ops/server/net.js';
import { ERR } from '../game_ops/shared/constants.js';
import { validateC2S } from '../game_ops/shared/protocol.js';
import { connectCampLobbies } from '../bridge/camp-lobby.js';
import { roomFacts } from '../game_ops/public/js/screens/room.js';
import { phaseTotalSeconds as alliancePhaseSeconds } from '../game_ops/public/js/ui/gameLogic/phases.js';
import { phaseTotalSeconds as invasionPhaseSeconds } from '../game/public/js/ui/gameLogic/phases.js';
import { createDuel, duelRound, duelSource, monsterSeatFor, opsSeatFor, readDuel, removeDuel, writeDuel } from '../bridge/duel.js';
import { MatchCombat as OpsCombat } from '../game_ops/server/match/match/combat.js';
import { MatchCombat as InvasionCombat } from '../game/server/match/match/combat.js';
import { MatchSettle as OpsSettle } from '../game_ops/server/match/match/settle.js';
import { MatchSettle as InvasionSettle } from '../game/server/match/match/settle.js';
import { makeMatch as makeAlliance } from '../game_ops/test/match/harness.js';
import { DATA as INVASION_DATA, makeMatch as makeInvasion } from '../game/test/match/harness.js';
import { planUnite, uniteSurvivors } from '../game_ops/server/match/unite.js';
import { BattleDeploy } from '../game_ops/server/sim/battle/deploy.js';
import { BattleEvents } from '../game_ops/server/sim/battle/events.js';
import { FieldRunner } from '../game_ops/server/match/fields.js';
import { applyCard, generateDraft } from '../game/server/match/choices.js';
import { createRng } from '../game/server/sim/rng.js';
import { TestClient } from '../game/test/helpers/wsClient.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

class MatchProbe {
  constructor(opts) { this.opts = opts; }
  start() { this.started = true; }
  dispose() {}
}

function setup(t) {
  const ops = new AllianceLobby({ registry: new SessionRegistry(), log: quiet, MatchClass: MatchProbe });
  const monster = new InvasionLobby({ registry: new SessionRegistry(), log: quiet, MatchClass: MatchProbe });
  connectCampLobbies(ops, monster);
  t.after(() => { ops.shutdown(); monster.shutdown(); });
  const player = (lobby, name) => {
    const session = lobby.registry.create(name);
    const frames = [];
    session.connected = true;
    session.ws = { readyState: 1, bufferedAmount: 0, send(bytes) { frames.push(JSON.parse(bytes)); } };
    return { session, state: () => frames.filter(frame => frame.t === 'room.state').at(-1) };
  };
  return { ops, monster, player };
}

test('the same code seats both factions and broadcasts their four slots to both sides', (t) => {
  const { ops, monster, player } = setup(t);
  const host = player(monster, 'Red host');
  const red = player(monster, 'Red guest');
  const blue = player(ops, 'Blue guest');
  assert.equal(monster.create(host.session, { mode: 'coop' }).ok, true);
  const code = host.session.roomCode;
  assert.deepEqual(host.state().campRoom.teams.ops, [null, null, null, null]);
  assert.equal(ops.join(blue.session, { code: code.toLowerCase() }).ok, true);
  assert.equal(monster.join(red.session, { code }).ok, true);
  assert.equal(blue.session.roomCode, code);
  assert.equal(blue.state().campRoom.camp, 'ops');
  assert.equal(blue.state().campRoom.hostCamp, 'monster');
  assert.deepEqual(blue.state().campRoom.teams, red.state().campRoom.teams);
  assert.equal(blue.state().campRoom.teams.ops[0].name, 'Blue guest');
  assert.equal(blue.state().campRoom.teams.monster[0].name, 'Red host');
  assert.equal(ops.ready(blue.session, { ready: true }).ok, true);
  assert.equal(red.state().campRoom.teams.ops[0].ready, true);
  assert.equal(ops.leave(blue.session).ok, true);
  assert.deepEqual(red.state().campRoom.teams.ops, [null, null, null, null]);
});

test('players and spectators can take a specific empty seat in their own faction', (t) => {
  const { ops, monster, player } = setup(t);
  const host = player(monster, 'Red host');
  const red = player(monster, 'Red guest');
  const blue = player(ops, 'Blue guest');
  const spectator = player(ops, 'Blue spectator');
  assert.equal(monster.create(host.session, { mode: 'coop' }).ok, true);
  const code = host.session.roomCode;
  assert.equal(monster.join(red.session, { code }).ok, true);
  assert.equal(ops.join(blue.session, { code }).ok, true);
  assert.equal(ops.spectate(spectator.session, { code }).ok, true);
  assert.equal(monster.ready(red.session, { ready: true }).ok, true);

  const take = (lobby, member, seat) => {
    const request = { t: 'room.join', code, seat };
    assert.equal(validateC2S(request), null);
    return lobby.handleMessage(member.session, request);
  };
  for (const seat of [-1, 4, 1.5, '2', null]) {
    assert.ok(validateC2S({ t: 'room.join', code, seat }));
  }
  assert.equal(take(monster, host, 2).ok, true);
  assert.equal(take(monster, host, 2).ok, true);
  assert.equal(monster.join(host.session, { code }).ok, true);
  assert.equal(take(monster, red, 2).error, ERR.BAD_TARGET);
  assert.equal(take(monster, red, 3).ok, true);
  assert.equal(take(ops, spectator, 0).error, ERR.BAD_TARGET);
  assert.equal(take(ops, spectator, 3).ok, true);
  assert.equal(take(ops, blue, 1).ok, true);
  assert.equal(monster.addBot(host.session, { camp: 'monster', seat: 0 }).ok, true);
  assert.equal(take(monster, red, 0).error, ERR.BAD_TARGET);

  const { hostId, teams } = host.state().campRoom;
  assert.equal(hostId, host.session.playerId);
  assert.equal(teams.monster[0].isBot, true);
  assert.equal(teams.monster[1], null);
  assert.equal(teams.monster[2].playerId, hostId);
  assert.equal(teams.monster[2].seat, 2);
  assert.equal(teams.monster[3].playerId, red.session.playerId);
  assert.equal(teams.monster[3].ready, true);
  assert.equal(teams.ops[0], null);
  assert.equal(teams.ops[1].playerId, blue.session.playerId);
  assert.equal(teams.ops[3].playerId, spectator.session.playerId);
  assert.deepEqual(spectator.state().spectators, []);
  for (const client of [red, blue, spectator]) assert.deepEqual(client.state().campRoom.teams, teams);
  assert.equal(take(monster, player(monster, 'Visitor'), 1).error, ERR.NOT_IN_ROOM);
  assert.equal(monster.addBot(host.session, { camp: 'monster', seat: 1 }).ok, true);
  for (const seat of [0, 2]) assert.equal(monster.addBot(host.session, { camp: 'ops', seat }).ok, true);
  for (const member of [blue, spectator]) assert.equal(ops.ready(member.session, { ready: true }).ok, true);
  assert.equal(monster.start(host.session).ok, true);
  assert.equal(take(monster, host, 1).error, ERR.ROOM_STARTED);
});

test('a faction has four places, and the shared room survives the founder leaving', (t) => {
  const { ops, monster, player } = setup(t);
  const host = player(ops, 'Founder');
  const red = player(monster, 'Successor');
  assert.equal(ops.create(host.session, { mode: 'coop' }).ok, true);
  const code = host.session.roomCode;
  assert.equal(monster.join(red.session, { code }).ok, true);
  for (let index = 1; index < 4; index++) {
    assert.equal(monster.join(player(monster, `Red ${index}`).session, { code }).ok, true);
  }
  assert.equal(monster.join(player(monster, 'Overflow').session, { code }).error, ERR.ROOM_FULL);
  assert.equal(ops.leave(host.session).ok, true);
  assert.equal(red.state().campRoom.hostCamp, 'monster');
  assert.equal(ops.join(player(ops, 'Return').session, { code }).ok, true);
  assert.equal(red.state().campRoom.hostCamp, 'monster');
});

test('cross-camp selection moves the same doctor and room host to the exact empty seat', (t) => {
  const { ops, monster, player } = setup(t);
  const red = player(monster, 'Founder');
  assert.equal(monster.create(red.session, { mode: 'coop' }).ok, true);
  const code = red.session.roomCode;
  const request = { t: 'room.moveCamp', camp: 'ops', code, seat: 2 };
  assert.equal(validateC2S(request), null);
  assert.ok(validateC2S({ t: 'room.moveCamp', camp: 'ops', code }));
  assert.equal(monster.addBot(red.session, { camp: 'monster', seat: 1 }).ok, true);
  const issued = monster.handleMessage(red.session, request);
  assert.match(issued.campTicket, /^[a-f0-9]{32}$/);
  assert.equal(red.session.roomCode, code);
  assert.equal(monster.claimCampSeat(issued.campTicket).error, ERR.BAD_TARGET);
  const { session } = ops.claimCampSeat(issued.campTicket);
  assert.equal(session.playerId, red.session.playerId);
  assert.equal(session.name, red.session.name);
  assert.notEqual(session.token, red.session.token);
  assert.equal(session.roomCode, code);
  assert.equal(ops.rooms.get(code).hostId, session.playerId);
  assert.equal(ops.rooms.get(code).seats[2].playerId, session.playerId);
  assert.equal(ops.rooms.get(code).seats[2].ready, false);
  assert.equal(monster.rooms.get(code).seats[0], null);
  assert.equal(monster.rooms.get(code).seats[1].isBot, true);
  assert.equal(monster.registry.byToken(red.session.token), null);
  assert.equal(ops.rooms.get(code).toState().campRoom.hostCamp, 'ops');
  session.connected = true;
  assert.equal(ops.claimCampSeat(issued.campTicket).error, ERR.BAD_TARGET);
  const back = ops.handleMessage(session, { ...request, camp: 'monster', seat: 3 });
  assert.equal(monster.claimCampSeat(back.campTicket).session.playerId, session.playerId);
  assert.equal(monster.rooms.get(code).toState().campRoom.teams.monster[3].playerId, session.playerId);
});

test('a busy destination seat leaves the original room membership intact', (t) => {
  const { ops, monster, player } = setup(t);
  const host = player(monster, 'Founder');
  const guest = player(monster, 'Guest');
  assert.equal(monster.create(host.session, { mode: 'coop' }).ok, true);
  const code = host.session.roomCode;
  assert.equal(monster.join(guest.session, { code }).ok, true);
  const request = { t: 'room.moveCamp', camp: 'ops', code, seat: 3 };
  const { campTicket } = monster.handleMessage(guest.session, request);
  assert.match(campTicket, /^[a-f0-9]{32}$/);
  assert.equal(monster.addBot(host.session, { camp: 'ops', seat: 3 }).ok, true);
  assert.deepEqual(ops.claimCampSeat(campTicket), { error: ERR.BAD_TARGET, detail: 'seat occupied' });
  assert.equal(guest.session.roomCode, code);
  assert.equal(monster.rooms.get(code).seats[1].playerId, guest.session.playerId);
  assert.equal(monster.rooms.get(code).hostId, host.session.playerId);
  assert.equal(monster.handleMessage(guest.session, request).detail, 'seat occupied');
});

test('a fresh destination socket resumes the transferred seat with a new reconnect token', { timeout: 15_000 }, async (t) => {
  const servers = [];
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.terminate()));
    await Promise.all(servers.map(server => server.close()));
  });
  for (const camp of ['game_ops', 'game']) {
    const { startServer } = await import(`../${camp}/server/index.js`);
    servers.push(await startServer({
      port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, studio: false,
    }));
  }
  const [ops, monster] = servers;
  connectCampLobbies(ops.lobby, monster.lobby);
  const open = async (server) => {
    const client = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
    clients.push(client);
    return client;
  };
  const host = await open(ops);
  const before = await host.hello('Founder');
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', version: undefined })).t, 'ok');
  const { code } = await host.waitFor('room.state');
  const reply = await host.request({ t: 'room.moveCamp', code, camp: 'monster', seat: 3 });
  assert.equal(reply.t, 'ok');
  assert.match(reply.campTicket, /^[a-f0-9]{32}$/);
  await host.close();

  const arriving = await open(monster);
  const after = await arriving.hello('Founder', undefined, { campTicket: reply.campTicket });
  const room = await arriving.waitFor('room.state');
  assert.equal(after.playerId, before.playerId);
  assert.notEqual(after.token, before.token);
  assert.equal(room.code, code);
  assert.equal(room.hostId, after.playerId);
  assert.equal(room.seats[3].playerId, after.playerId);
  assert.equal(room.seats[3].connected, true);
  assert.equal(room.campRoom.hostCamp, 'monster');

  await arriving.close();
  const reconnect = await open(monster);
  assert.equal((await reconnect.hello('Founder', after.token)).playerId, before.playerId);
  assert.equal((await reconnect.waitFor('room.state')).seats[3].playerId, before.playerId);
});

test('the shared host can fill both camps with AI and launch against a four-bot alliance', (t) => {
  const { ops, monster, player } = setup(t);
  const host = player(monster, 'Red host');
  assert.equal(monster.create(host.session, { mode: 'coop' }).ok, true);
  const code = host.session.roomCode;
  const send = (message) => {
    assert.equal(validateC2S(message), null);
    return monster.handleMessage(host.session, message);
  };
  for (const seat of [3, 0, 2, 1]) assert.equal(send({ t: 'room.addBot', camp: 'ops', seat }).ok, true);
  for (const seat of [1, 2, 3]) assert.equal(send({ t: 'room.addBot', camp: 'monster', seat }).ok, true);
  assert.ok(host.state().campRoom.teams.ops.every(seat => seat.isBot && seat.ready));
  assert.equal(roomFacts(host.state(), host.session.playerId).canStart, true);
  assert.equal(monster.start(host.session).ok, true);
  const blueRoom = ops.rooms.get(code);
  const redRoom = monster.rooms.get(code);
  assert.equal(blueRoom.match.started, true);
  assert.equal(blueRoom.match.opts.hostId, null);
  assert.ok(blueRoom.match.opts.seats.every(seat => seat.isBot));
  assert.deepEqual(blueRoom.match.opts.duel, redRoom.match.opts.duel);
  assert.equal(send({ t: 'room.removeBot', camp: 'ops', seat: 3 }).error, ERR.ROOM_STARTED);
  ops.onMatchEnd(blueRoom, blueRoom.matchCtx, { reason: 'duel-finished' });
  monster.onMatchEnd(redRoom, redRoom.matchCtx, { reason: 'duel-finished' });
  assert.ok(host.state().campRoom.teams.ops.every(seat => seat.isBot));
  assert.equal(monster.leave(host.session).ok, true);
  assert.equal(ops.rooms.has(code), false);
});

test('a full 4v4 version room starts after the data on disk changes', { timeout: 15_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sp-camp-version-'));
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map(server => server.close()));
    await rm(root, { recursive: true, force: true });
  });
  const version = 'act3autochess@V3_1';
  const slug = 'act3autochess-v3_1';
  for (const camp of ['game_ops', 'game']) {
    const { startServer } = await import(`../${camp}/server/index.js`);
    const dataDir = join(root, camp);
    const versionDir = join(dataDir, 'versions', slug);
    await mkdir(versionDir, { recursive: true });
    await cp(new URL(`../${camp}/data/versions/${slug}/`, import.meta.url), versionDir, { recursive: true });
    const server = await startServer({
      dataDir, port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, studio: false, versions: { enabled: [version] },
    });
    servers.push(server);
    await appendFile(join(versionDir, 'chess.json'), '\n');
  }

  const [ops, monster] = servers;
  connectCampLobbies(ops.lobby, monster.lobby);
  const lobby = monster.lobby;
  const host = lobby.registry.create('Invasion host');
  host.connected = true;
  const opened = new Promise((resolve, reject) => {
    host.ws = { readyState: 1, bufferedAmount: 0, send(bytes) {
      const message = JSON.parse(bytes);
      if (message.t === 'm.public') resolve(message);
      if (message.t === 'm.toast' && message.kind === 'error') reject(new Error(message.text || message.msg || JSON.stringify(message)));
    } };
  });
  assert.equal(lobby.create(host, { mode: 'coop', version }).ok, true);
  const room = lobby.rooms.get(host.roomCode);
  assert.equal(lobby.contentReady(host, { cs: room.content.cs }).ok, true);
  for (const camp of ['ops', 'monster']) {
    for (let seat = camp === 'monster' ? 1 : 0; seat < 4; seat++) {
      assert.equal(lobby.handleMessage(host, { t: 'room.addBot', camp, seat }).ok, true);
    }
  }
  assert.equal(lobby.start(host).ok, true);
  assert.equal((await opened).phase, 'INFO_CHECK');

  for (const server of servers) {
    const cs = server.versions.csOf(version);
    const match = server.lobby.rooms.get(room.code).match;
    assert.ok(match?.hosted);
    const diagnostics = await match.diag();
    assert.equal(diagnostics.version, version);
    assert.equal(diagnostics.cs, cs);
    const index = await fetch(`${server.url}/cs/${cs.slice(0, 16)}/index.json`).then(response => response.json());
    const bytes = await fetch(server.url + index.data.chess.url).then(response => response.arrayBuffer());
    assert.equal(createHash('sha256').update(Buffer.from(bytes)).digest('hex'), index.data.chess.sha256);
  }
});

test('cross-camp bot controls target the selected seat and preserve human slots and host permissions', (t) => {
  const { ops, monster, player } = setup(t);
  const host = player(ops, 'Alliance host');
  const guest = player(monster, 'Invasion guest');
  assert.equal(ops.create(host.session, { mode: 'coop' }).ok, true);
  assert.equal(ops.handleMessage(host.session, { t: 'room.addBot', camp: 'monster', seat: 3 }).ok, true);
  assert.equal(monster.join(guest.session, { code: host.session.roomCode }).ok, true);
  assert.equal(guest.state().campRoom.teams.monster[0].playerId, guest.session.playerId);
  assert.equal(guest.state().campRoom.teams.monster[1], null);
  assert.equal(guest.state().campRoom.teams.monster[3].isBot, true);
  assert.equal(monster.handleMessage(guest.session, { t: 'room.addBot', camp: 'ops', seat: 3 }).error, ERR.NOT_HOST);
  assert.equal(ops.handleMessage(host.session, { t: 'room.addBot', camp: 'monster', seat: 0 }).error, ERR.BAD_TARGET);
  assert.equal(ops.handleMessage(host.session, { t: 'room.removeBot', camp: 'monster', seat: 0 }).error, ERR.BAD_TARGET);
  assert.equal(ops.handleMessage(host.session, { t: 'room.removeBot', camp: 'monster', seat: 3 }).ok, true);
  assert.equal(guest.state().campRoom.teams.monster[3], null);
});

test('solo room codes cannot seat opponents', (t) => {
  const { ops, monster, player } = setup(t);
  const host = player(ops, 'Solo');
  assert.equal(ops.create(host.session, { mode: 'solo' }).ok, true);
  assert.equal(monster.join(player(monster, 'Opponent').session, { code: host.session.roomCode }).error, ERR.ROOM_NOT_FOUND);
  assert.equal(host.state().campRoom, undefined);
});

test('only the shared host starts both prepared halves of a full lobby', (t) => {
  const { ops, monster, player } = setup(t);
  const host = player(ops, 'Founder');
  assert.equal(ops.create(host.session, { mode: 'coop' }).ok, true);
  const code = host.session.roomCode;
  assert.equal(ops.start(host.session).error, ERR.NOT_READY);
  const red = player(monster, 'Red captain');
  assert.equal(monster.join(red.session, { code }).ok, true);
  for (const side of [ops, monster]) {
    for (let index = 1; index < 4; index++) {
      const guest = player(side, `Guest ${index}`);
      assert.equal(side.join(guest.session, { code }).ok, true);
      assert.equal(side.ready(guest.session, { ready: true }).ok, true);
    }
  }
  assert.equal(roomFacts(host.state(), host.session.playerId).canStart, false);
  assert.equal(roomFacts(red.state(), red.session.playerId).isHost, false);
  assert.equal(monster.start(red.session).error, ERR.NOT_HOST);
  assert.equal(monster.ready(red.session, { ready: true }).ok, true);
  assert.equal(roomFacts(host.state(), host.session.playerId).canStart, true);
  assert.deepEqual(ops.start(host.session), { ok: true });
  const blueMatch = ops.roomOf(host.session).match;
  const redMatch = monster.roomOf(red.session).match;
  assert.equal(blueMatch.started, true);
  assert.equal(redMatch.started, true);
  assert.equal(blueMatch.opts.seats.length, 4);
  assert.equal(redMatch.opts.seats.length, 4);
  assert.deepEqual(blueMatch.opts.duel, redMatch.opts.duel);
});

test('four submitted lanes stay distinct, rotate, and end from the same round result', (t) => {
  const duel = createDuel();
  t.after(() => removeDuel(duel));
  const players = Array.from({ length: 4 }, (_, seat) => ({ seat, playerId: `ops-${seat}`, lp: 10 }));
  const opsPolls = [], invasionPolls = [];
  const ops = {
    opts: { duel }, round: 14, order: players, alivePlayers: () => players, wave: { routes: [] },
    later: (ms, callback) => opsPolls.push(callback), _beginCombat() { this.begun = true; },
    finish(outcome) { this.outcome = outcome; },
  };
  const invasion = {
    opts: { duel }, round: 14, order: players, watchers: new Map(),
    later: (ms, callback) => invasionPolls.push(callback),
    _monsterLineup: seat => [{ enemyKey: `enemy-${seat}` }],
    _monsterWavePayload: spawns => ({ spawns }),
    markPublic() {}, _viewers: () => [],
    settle() { this.phase = 'SETTLE'; }, finish(outcome) { this.outcome = outcome; },
  };
  OpsCombat.prototype.startCombat.call(ops);
  assert.equal(ops.begun, undefined);
  InvasionCombat.prototype._startDuelCombat.call(invasion);
  assert.equal(invasion.phase, undefined);
  opsPolls.shift()();
  assert.equal(ops.begun, true);
  invasionPolls.shift()();
  assert.equal(invasion.phase, 'COMBAT');
  assert.deepEqual([...ops._duelWaves.values()].map(wave => wave.spawns[0].enemyKey), ['enemy-1', 'enemy-2', 'enemy-3', 'enemy-0']);
  assert.equal(new Set([...ops._duelWaves.values()].map(wave => wave.sourceId)).size, 4);
  for (const player of players) assert.equal(opsSeatFor(monsterSeatFor(player.seat, 14), 14), player.seat);
  const result = duelRound(players, { 'ops-1': 2, 'ops-3': 3 }, 14);
  assert.deepEqual(result.pool, { ops: 35 });
  assert.equal(result.winner, 'ops');
  ops._duelResult = result;
  OpsSettle.prototype.afterSettle.call(ops);
  assert.equal(ops.outcome.victory, true);
  assert.equal(readDuel(duel, 'round-14-start').pool.ops, 40);
  invasion._duelResult = result;
  InvasionSettle.prototype.afterSettle.call(invasion);
  assert.equal(invasion.outcome.victory, false);
});

test('4v4 camps with one human each get the same full prep time when the second camp enters', (t) => {
  const duel = createDuel();
  const ops = makeAlliance({ humans: 1, fake: true });
  const monster = makeInvasion({ humans: 1, fake: true });
  t.after(() => { ops.m.dispose(); monster.m.dispose(); removeDuel(duel); });
  ops.m.opts.duel = monster.m.opts.duel = duel;
  const secondsByRound = [40, 45, 51, 56, 62, 67, 72, 78, 83, 88, 94, 99, 105, 110];
  for (const [index, seconds] of secondsByRound.entries()) {
    const round = index + 1;
    const [first, second] = round % 2 ? [ops, monster] : [monster, ops];
    first.m.round = second.m.round = round;
    first.m.enterPrep();
    first.sched.advance(200);
    assert.equal(first.m.publicView().deadline, 0);
    second.sched.advance(first.sched.now() - second.sched.now() + 1_800);
    const deadline = second.sched.now() + seconds * 1_000;
    second.m.enterPrep();
    first.sched.advance(second.sched.now() - first.sched.now());
    assert.equal(first.m.publicView().deadline, deadline);
    assert.equal(second.m.publicView().deadline, deadline);
    for (const [camp, hudSeconds] of [[ops, alliancePhaseSeconds], [monster, invasionPhaseSeconds]]) {
      assert.equal(hudSeconds(camp.m.publicView(), camp.m.gd.config), seconds);
    }
  }
});

test('the 4v4 prep deadline launches combat with unfinished players and remains visible to a ready camp', (t) => {
  const duel = createDuel();
  const ops = makeAlliance({ humans: 1, fake: true, instant: false });
  const monster = makeInvasion({ humans: 1, fake: true, instant: false });
  t.after(() => { ops.m.dispose(); monster.m.dispose(); removeDuel(duel); });
  for (const side of [ops, monster]) {
    side.m.opts.duel = duel;
    side.m._startRoundAfterOffers(1);
    side.runToPhase('PREP', 1);
  }
  ops.sched.advance(200);
  const deadline = monster.m.deadline;
  assert.equal(deadline - monster.sched.now(), 40_000);
  assert.equal(ops.m.alivePlayers()[0].setReady(true).ok, true);
  ops.sched.advance(200);
  assert.equal(ops.m.publicView().duelWaiting, true);
  assert.equal(ops.m.publicView().deadline, deadline);

  for (const side of [ops, monster]) side.sched.advance(deadline - side.sched.now() - 1);
  assert.equal(monster.m.alivePlayers()[0].ready, false);
  assert.equal(ops.m.phase, 'PREP');
  assert.equal(readDuel(duel, 'round-1-start'), null);

  monster.sched.advance(1);
  assert.equal(monster.m.alivePlayers()[0].ready, true);
  assert.ok(readDuel(duel, 'round-1-lineups'));
  ops.runToPhase('COMBAT', 1, { maxTime: 100 });
  monster.runToPhase('COMBAT', 1, { maxTime: 100 });
  assert.ok(readDuel(duel, 'round-1-start'));
  assert.deepEqual(ops.logs.error, []);
  assert.deepEqual(monster.logs.error, []);
});

test('both camps see current preparations and the same rotating attack and defense pairings', (t) => {
  const duel = createDuel();
  const seats = (camp) => Array.from({ length: 4 }, (_, seat) => ({
    seat, playerId: `${camp}-${seat}`, name: `${camp} P${seat + 1}`, connected: true,
  }));
  const ops = makeAlliance({ seats: seats('ops'), fake: true });
  const monster = makeInvasion({ seats: seats('monster'), fake: true });
  t.after(() => { ops.m.dispose(); monster.m.dispose(); removeDuel(duel); });
  for (const { m } of [ops, monster]) {
    m.opts.duel = duel;
    m.round = 1;
    m.enterPrep();
  }

  const defender = ops.m.order[0];
  const chessId = Object.keys(ops.m.gd.raw.chess).find(id => !ops.m.gd.chess(id).isGolden);
  const deployed = defender.newPiece('chess', chessId);
  const benched = defender.newPiece('chess', chessId);
  const position = [...defender.deployMap().keys()][0];
  const [row, col] = position.split(',').map(Number);
  defender.board.set(position, deployed);
  defender.hand[0] = benched;
  const bondId = Object.keys(ops.m.gd.raw.bonds)[0];
  defender.bonds[bondId] = { count: 1, layers: 7, tier: 0, active: false };
  ops.sched.advance(500);
  monster.sched.advance(500);
  ops.sched.advance(500);

  const lanes = ops.m.publicView().duelMatchups;
  assert.deepEqual(lanes, monster.m.publicView().duelMatchups);
  assert.deepEqual(lanes.map(l => [l.attacker.playerId, l.defender.playerId]), [
    ['monster-0', 'ops-0'], ['monster-1', 'ops-1'], ['monster-2', 'ops-2'], ['monster-3', 'ops-3'],
  ]);
  assert.deepEqual(lanes[0].defender.formation.units.map(u => [u.id, u.x, u.y]), [[deployed.uid, col, row]]);
  assert.equal(lanes[0].defender.formation.bonds.find(b => b.bondId === bondId)?.layers, 7);
  assert.equal(lanes[0].defender.hand, undefined);
  assert.equal(lanes[0].gateLeaks, null);
  const maps = ops.m.publicView().duelFormationMaps;
  assert.deepEqual(maps, monster.m.publicView().duelFormationMaps);
  assert.equal(maps.ops.rect.r1, 12);
  assert.equal(maps.monster.rect.r1, 17);
  assert.notDeepEqual(maps.ops.stage.rows, maps.monster.stage.rows);

  ops.m.round = 2;
  defender.board.clear();
  ops.m.enterPrep();
  const waiting = ops.m.publicView().duelMatchups;
  assert.equal(waiting[0].attacker.formation, null, 'the previous round board is not shown as the current preparation');
  monster.m.round = 2;
  monster.m.enterPrep();
  ops.sched.advance(500);
  monster.sched.advance(500);
  const rotated = ops.m.publicView().duelMatchups;
  assert.deepEqual(rotated, monster.m.publicView().duelMatchups);
  assert.deepEqual(rotated.map(l => [l.attacker.playerId, l.defender.playerId]), [
    ['monster-0', 'ops-3'], ['monster-1', 'ops-0'], ['monster-2', 'ops-1'], ['monster-3', 'ops-2'],
  ]);
  assert.deepEqual(rotated[1].defender.formation.units, []);
  ops.m.phase = 'COMBAT';
  ops.m.fields = [{ fieldId: 'n:ops-0', kind: 'normal', players: ['ops-0'], live: true, battle: { gateLeaks: 2 } }];
  monster.m.phase = 'COMBAT';
  monster.m._duelLive = new Map([[1, { meta: { fieldId: 'n:ops-0' }, snap: { gateLeaks: 2 } }]]);
  for (const { m } of [ops, monster]) {
    const lane = m.publicView().duelMatchups[1];
    assert.equal(lane.defender.playerId, 'ops-0');
    assert.equal(lane.fieldId, 'n:ops-0');
    assert.equal(lane.gateLeaks, 2);
  }
  assert.equal(ops.m.errorCount + monster.m.errorCount, 0);
});

test('invasion viewers receive lane completion, keep it on watch and reconnect, and switch to the joint battle', (t) => {
  const duel = createDuel();
  const alliance = makeAlliance({ humans: 4, fake: true });
  const invasion = makeInvasion({ humans: 4, fake: true, data: { ...INVASION_DATA, config: { ...INVASION_DATA.config, monsterOnly: true } } });
  t.after(() => { alliance.m.dispose(); invasion.m.dispose(); removeDuel(duel); });
  for (const side of [alliance, invasion]) {
    side.m.opts.duel = duel;
    side.m.round = 1;
  }
  const [blue, otherBlue] = alliance.m.alivePlayers();
  const [first, second] = invasion.m.alivePlayers();
  const spectator = 'red-spectator';
  invasion.m.addSpectator(spectator);
  alliance.m._duelWaves = new Map([
    [blue.seat, { sourceId: duelSource(duel, 1, first.seat) }],
    [otherBlue.seat, { sourceId: duelSource(duel, 1, second.seat) }],
  ]);
  const emitField = (fieldId, kind, player = blue, live = true, gateLeaks = 0) => {
    const time = live ? 1 : 2;
    const battle = {
      time,
      finished: !live,
      drainEvents: () => [['test-event']],
      gateLeaks,
      snapshot: () => ({ t: time, units: [], gateLeaks }),
      fieldMeta: () => ({ fieldId, kind, stageId: 'act3autochess_m05' }),
    };
    const field = { fieldId, kind, players: [player.playerId], live, battle };
    alliance.m.fields = [...alliance.m.fields.filter(f => f.fieldId !== fieldId), field];
    new FieldRunner(alliance.m, [field], { onDone() {} })._emit(field);
  };
  writeDuel(duel, 'round-1-start', { pool: { ops: 40 } });
  emitField('normal-other', 'normal', otherBlue, true, 2);
  invasion.m._startDuelCombat();
  assert.equal(invasion.lastTo(spectator, 'm.field')?.fieldId, 'normal-other', 'the spectator starts on an available lane');
  emitField('normal-blue', 'normal');
  invasion.sched.advance(110);
  assert.equal(invasion.lastTo(first.playerId, 'm.field')?.fieldId, 'normal-blue');
  assert.equal(invasion.lastTo(first.playerId, 'm.field')?.live, true);
  assert.equal(invasion.lastTo(second.playerId, 'm.field')?.fieldId, 'normal-other');
  assert.deepEqual(invasion.m.publicView().fields.map(f => [f.fieldId, f.live]), [['normal-blue', true], ['normal-other', true]]);
  assert.deepEqual(Object.fromEntries(alliance.m.publicView().fields.map(f => [f.fieldId, f.gateLeaks])), { 'normal-blue': 0, 'normal-other': 2 });
  assert.deepEqual(invasion.m.publicView().fields.map(f => f.gateLeaks), [0, 2]);
  assert.equal(invasion.m.handle(spectator, { t: 'g.watch', fieldId: 'normal-other' }).ok, true);
  assert.equal(invasion.lastTo(spectator, 'b.snap')?.gateLeaks, 2);
  assert.equal(invasion.m.handle(first.playerId, { t: 'g.watch', fieldId: 'normal-other' }).ok, true);
  assert.equal(invasion.lastTo(first.playerId, 'm.field')?.fieldId, 'normal-other');
  assert.equal(invasion.lastTo(first.playerId, 'b.snap')?.fieldId, 'normal-other');
  invasion.m.onDisconnect(first.playerId);
  invasion.sent.length = 0;
  invasion.m.onReconnect(first.playerId);
  assert.equal(invasion.lastTo(first.playerId, 'm.field')?.fieldId, 'normal-other');
  assert.deepEqual(invasion.lastTo(first.playerId, 'm.public')?.fields.map(f => f.gateLeaks), [0, 2]);
  invasion.sent.length = 0;
  emitField('normal-blue', 'normal', blue, true, 1);
  emitField('normal-other', 'normal', otherBlue, true, 3);
  invasion.sched.advance(110);
  assert.equal(invasion.lastTo(first.playerId, 'b.snap')?.fieldId, 'normal-other');
  assert.equal(invasion.m.handle(first.playerId, { t: 'g.watch', fieldId: 'n:missing' })?.error, ERR.BAD_TARGET);

  invasion.sent.length = 0;
  emitField('normal-other', 'normal', otherBlue, false, 3);
  invasion.sched.advance(110);
  assert.equal(invasion.lastBc('m.public')?.phase, 'COMBAT');
  assert.deepEqual(invasion.lastBc('m.public')?.fields.map(f => [f.fieldId, f.live]), [['normal-blue', true], ['normal-other', false]]);
  assert.deepEqual(invasion.lastBc('m.public')?.fields.map(f => f.gateLeaks), [1, 3]);
  assert.equal(invasion.lastBc('m.public')?.duelPool.ops, 40);
  assert.equal(invasion.lastTo(first.playerId, 'b.snap')?.gt, 2);
  assert.equal(invasion.lastTo(first.playerId, 'm.field'), null, 'completion keeps the current view and its event buffer');

  for (const [fieldId, live, gt] of [['normal-blue', true, 1], ['normal-other', false, 2]]) {
    assert.equal(invasion.m.handle(first.playerId, { t: 'g.watch', fieldId }).ok, true);
    assert.equal(invasion.lastTo(first.playerId, 'm.field')?.live, live);
    assert.equal(invasion.lastTo(first.playerId, 'b.snap')?.gt, gt);
  }
  invasion.m.onDisconnect(first.playerId);
  invasion.sent.length = 0;
  invasion.m.onReconnect(first.playerId);
  assert.equal(invasion.lastTo(first.playerId, 'm.field')?.fieldId, 'normal-other');
  assert.equal(invasion.lastTo(first.playerId, 'm.field')?.live, false);
  assert.equal(invasion.lastTo(first.playerId, 'b.snap')?.gt, 2);

  alliance.m.deadline = 45_000;
  emitField('u', 'unite', blue, true, 0);
  invasion.run(() => invasion.m.phase === 'UNITE', { maxSteps: 15 });
  const state = invasion.m.publicView();
  assert.equal(state.phase, 'UNITE');
  assert.equal(state.deadline, 45_000);
  assert.deepEqual(state.fields, [{ fieldId: 'u', kind: 'unite', players: invasion.m.alivePlayers().map(player => player.playerId), live: true, gateLeaks: 0 }]);
  for (const player of [first, second, { playerId: spectator }]) {
    assert.equal(invasion.lastTo(player.playerId, 'm.field')?.fieldId, 'u');
    assert.equal(invasion.lastTo(player.playerId, 'b.ev')?.fieldId, 'u');
    assert.equal(invasion.lastTo(player.playerId, 'b.snap')?.fieldId, 'u');
  }
  emitField('u', 'unite', blue, true, 1);
  invasion.sched.advance(110);
  assert.equal(invasion.lastTo(spectator, 'b.snap')?.gateLeaks, 1);
  assert.equal(invasion.m.publicView().fields[0].gateLeaks, 1);
  assert.equal(invasion.m.publicView().duelPool.ops, 40);
  invasion.m.onDisconnect(second.playerId);
  invasion.sent.length = 0;
  invasion.m.onReconnect(second.playerId);
  assert.equal(invasion.lastTo(second.playerId, 'm.public')?.phase, 'UNITE');
  assert.equal(invasion.lastTo(second.playerId, 'm.field')?.fieldId, 'u');
  assert.equal(invasion.lastTo(second.playerId, 'b.snap')?.fieldId, 'u');
  emitField('u', 'unite', blue, false, 1);
  writeDuel(duel, 'round-1-result', { pool: { ops: 38 }, final: false, winner: null });
  invasion.run(() => invasion.m.phase === 'SETTLE', { maxSteps: 15 });
  assert.equal(invasion.m.phase, 'SETTLE');
  assert.equal(invasion.lastTo(first.playerId, 'b.snap')?.gt, 2);
  assert.deepEqual(invasion.m.publicView().fields.map(f => [f.fieldId, f.live]), [['u', false]]);
  assert.deepEqual(invasion.m.publicView().duelPool, { ops: 38 });
});

test('disconnected duel humans are temporarily controlled by AI on both sides', (t) => {
  const duel = createDuel();
  t.after(() => removeDuel(duel));
  for (const createMatch of [makeAlliance, makeInvasion]) {
    const { m } = createMatch({ humans: 4, fake: true });
    t.after(() => m.dispose());
    m.opts.duel = duel;
    m.phase = 'PREP';
    const [player] = m.alivePlayers();
    const scheduled = [];
    m.scheduleBotPrep = (seat) => scheduled.push(seat.playerId);
    m.onDisconnect(player.playerId);
    assert.equal(player.botControlled, true);
    assert.deepEqual(scheduled, [player.playerId]);
    m.onReconnect(player.playerId);
    assert.equal(player.botControlled, false);
    player.autoplay = true;
    m.onDisconnect(player.playerId);
    m.onReconnect(player.playerId);
    assert.equal(player.botControlled, true);
  }
});

test('defense charges the shared cap without per-lane caps or lost overflow', () => {
  const players = [
    { playerId: 'first', lp: 3 }, { playerId: 'second', lp: 25 },
    { playerId: 'third', lp: 20 }, { playerId: 'fourth', lp: 12 },
  ];
  const result = duelRound(players, { first: 50 }, 1);
  assert.deepEqual(result.losses, { first: 3, second: 25, third: 12, fourth: 0 });
  assert.deepEqual(result.pool, { ops: 20 });
  assert.equal(result.final, false);
  const fewer = duelRound(players.slice(1, 3), { second: 22 }, 14);
  assert.deepEqual(fewer.pool, { ops: 25 });
  assert.equal(fewer.winner, 'ops');
  for (const round of [1, 14]) {
    const collapse = duelRound([{ playerId: 'last', lp: 2 }], { last: 2 }, round);
    assert.equal(collapse.final, true);
    assert.equal(collapse.winner, 'monster');
  }
});

test('联合作战 resends timeout survivors and bills the remaining invaders once', () => {
  const helper = { playerId: 'helper', seat: 0, bounties: [], deployCount: 0, board: new Map() };
  const leaker = { playerId: 'leaker', seat: 1, bounties: [] };
  const goal = { enemyKey: 'invader', sourcePlayerId: 'red', goalReached: true };
  const stopped = { ...goal, goalReached: false };
  const bounty = { ...goal, sourcePlayerId: leaker.playerId };
  const match = { opts: { duel: {} }, alivePlayers: () => [helper, leaker], gd: { enemy: () => ({}), unite: { maxHelpers: 2 } } };
  const plan = planUnite(match, new Map([
    [helper.playerId, { leaked: [{ ...stopped, sourcePlayerId: helper.playerId }], perfect: false }],
    [leaker.playerId, { leaked: [goal, stopped, bounty], perfect: false }],
  ]));
  assert.deepEqual(plan.helpers, [helper]);
  assert.deepEqual(plan.leakers, [leaker]);
  assert.equal(plan.leaked.length, 2);
  const result = { perPlayer: { helper: { leaked: [
    { ...goal, sourcePlayerId: leaker.playerId },
    { ...stopped, sourcePlayerId: leaker.playerId },
    { ...goal, sourcePlayerId: helper.playerId },
    { ...stopped, sourcePlayerId: leaker.playerId, uniteRuntime: true },
  ] } }, unspawned: [{ sourcePlayerId: leaker.playerId }] };
  plan.notReentered.set(leaker.playerId, 1);
  assert.deepEqual(uniteSurvivors(plan, result, { duel: true }), new Map([[leaker.playerId, 2]]));
});

test('duel snapshots count invading enemies that actually reach the exit gate', () => {
  const perPlayer = { leaked: [] };
  const battle = {
    flags: { duelGateLeaks: true }, players: [], allyUnits: [], units: [], time: 0,
    _ownerForTile: () => 'blue', _pp: id => id === 'blue' ? perPlayer : null, gateLeaks: 0,
  };
  const enemy = { defId: 'invader', ownerId: 'blue', sourcePlayerId: 'red', counted: true, x: 2, y: 3 };
  BattleDeploy.prototype._recordLeak.call(battle, enemy, false);
  BattleDeploy.prototype._recordLeak.call(battle, enemy, true);
  assert.deepEqual(perPlayer.leaked.map(entry => entry.goalReached), [true, false]);
  BattleDeploy.prototype._recordLeak.call(battle, { ...enemy, sourcePlayerId: 'blue' }, false);
  BattleDeploy.prototype._recordLeak.call(battle, { ...enemy, uniteRuntime: true }, false);
  BattleDeploy.prototype._recordLeak.call(battle, { ...enemy, counted: false }, false);
  BattleDeploy.prototype._recordLeak.call(battle, enemy, false);
  assert.equal(BattleEvents.prototype.snapshot.call(battle).gateLeaks, 2);
});

test('alliance settlement includes timeouts after joint or separate battles', (t) => {
  const duel = createDuel();
  const settle = (joint) => {
    const { m } = makeAlliance({ humans: 2, seats: [
      { playerId: 'blue-1', name: 'Blue 1' }, { playerId: 'blue-2', name: 'Blue 2' }, null, null,
    ], fake: true });
    t.after(() => m.dispose());
    m.opts.duel = duel;
    m.round = joint ? 13 : 14;
    const [first, second] = m.alivePlayers();
    first.lp = 2;
    second.lp = 15;
    const goal = { enemyKey: 'invader', sourcePlayerId: 'red', goalReached: true, counted: true };
    const stopped = { ...goal, goalReached: false };
    m.lastResults = new Map([
      [first.playerId, { leaked: Array(15).fill(goal) }],
      [second.playerId, { leaked: [goal, stopped] }],
    ]);
    const plan = { helpers: [second], leakers: [first], notReentered: new Map() };
    const fight = { perPlayer: { [second.playerId]: { leaked: [
      { ...goal, sourcePlayerId: first.playerId }, { ...stopped, sourcePlayerId: first.playerId },
    ] } } };
    m.settle(joint ? plan : null, joint ? fight : null);
    return { first, second, m, published: readDuel(duel, `round-${m.round}-result`) };
  };
  t.after(() => removeDuel(duel));
  const joint = settle(true);
  assert.deepEqual([joint.first.lp, joint.second.lp], [0, 15]);
  assert.deepEqual(joint.published.pool, { ops: 15 });
  assert.equal(joint.m.uniteResultView.through, 2);
  const separate = settle(false);
  assert.deepEqual([separate.first.lp, separate.second.lp], [0, 0]);
  assert.deepEqual(separate.published.pool, { ops: 0 });
  assert.equal(separate.published.winner, 'monster');
});

test('next-round funds use personal defence and the final cross-camp damage', (t) => {
  const duel = createDuel();
  t.after(() => removeDuel(duel));
  const goal = { enemyKey: 'enemy_1422_lrsldr', sourcePlayerId: 'red', goalReached: true, counted: true };
  const timeout = { ...goal, goalReached: false };
  const scenarios = [
    { lane: [], joint: null, loss: 0, alliance: [2, 2], invasion: 0 },
    { lane: [goal], joint: [], loss: 0, alliance: [1, 2], invasion: 0 },
    { lane: [goal], joint: null, loss: 1, alliance: [0, 1], invasion: 1 },
    { lane: [goal], joint: [goal, goal], loss: 2, alliance: [0, 1], invasion: 1 },
    { lane: [timeout], joint: null, loss: 1, alliance: [0, 1], invasion: 0 },
    { lane: [goal], joint: [timeout], loss: 1, alliance: [0, 1], invasion: 0 },
    { lane: [goal], joint: [{ ...timeout, reenteredAfterGoal: true }], loss: 1, alliance: [0, 1], invasion: 1 },
    { lane: [{ ...goal, counted: false, invasionSummon: true }], joint: null,
      loss: 1, alliance: [0, 1], invasion: 1 },
    { lane: [{ ...goal, counted: false, invasionSummon: true }],
      joint: [{ ...timeout, counted: false, invasionSummon: true, reenteredAfterGoal: true }],
      loss: 1, alliance: [0, 1], invasion: 1 },
    { lane: [goal], joint: [{ ...goal, counted: false, uniteRuntime: true, invasionSummon: true }],
      loss: 1, alliance: [0, 1], invasion: 1 },
  ];
  for (const [index, { lane, joint, loss, alliance, invasion }] of scenarios.entries()) {
    const blue = makeAlliance({ mode: 'coop', humans: 2, fake: true });
    const red = makeInvasion({ mode: 'coop', humans: 2, fake: true });
    try {
      for (const { m } of [blue, red]) {
        m.opts.duel = duel;
        m.round = index + 1;
      }
      const [leaker, helper] = blue.m.alivePlayers();
      const invaders = red.m.alivePlayers();
      leaker.lp = helper.lp = 15;
      blue.m.lastResults = new Map([[leaker.playerId, { leaked: lane }], [helper.playerId, { leaked: [] }]]);
      const plan = joint && planUnite(blue.m, blue.m.lastResults);
      if (joint) {
        assert.deepEqual(plan.leakers, [leaker]);
        assert.equal(plan.leaked[0]?.reenteredAfterGoal, true);
      }
      const result = joint && { perPlayer: { [helper.playerId]: {
        leaked: joint.map(leak => ({ ...leak, sourcePlayerId: leaker.playerId })),
      } } };
      const funds = [leaker, helper, ...invaders].map(player => player.funds);
      blue.m.settle(plan, result);
      red.m._duelResult = readDuel(duel, `round-${blue.m.round}-result`);
      red.m.settle(null, null);
      assert.equal(blue.m._duelResult.pool.ops, 30 - loss);
      assert.deepEqual([leaker.pendingFunds, helper.pendingFunds], alliance);
      assert.deepEqual(invaders.map(player => player.pendingFunds), [invasion, invasion]);
      assert.deepEqual([leaker, helper, ...invaders].map(player => player.funds), funds, 'funds arrive next round');
      blue.m.settle(plan, result);
      red.m.settle(null, null);
      assert.deepEqual([leaker.pendingFunds, helper.pendingFunds], alliance, 'one defensive payout');
      assert.deepEqual(invaders.map(player => player.pendingFunds), [invasion, invasion], 'one team payout');
      for (const [player, bonus] of [[leaker, alliance[0]], [helper, alliance[1]], ...invaders.map(p => [p, invasion])]) {
        const next = blue.m.round + 1;
        const before = player.funds;
        player.startRound(next);
        assert.equal(player.funds - before, player.gd.income(next) + bonus);
        assert.equal(player.pendingFunds, 0);
      }
    } finally {
      blue.m.dispose();
      red.m.dispose();
    }
  }
});

test('invasion supply and shop drafts grant personal bonuses through purchases and dispatched waves', (t) => {
  const { m } = makeInvasion({ humans: 2, fake: true });
  t.after(() => m.dispose());
  const [buyer, teammate] = m.alivePlayers();
  const forcedSchedule = family => ({
    config: m.gd.config,
    modeId: m.gd.modeId,
    choices: { schedule: { [m.gd.modeId]: { rounds: { 3: { families: [{ family, weight: 1 }], cards: 6 } } } } },
  });
  const draft = generateDraft(forcedSchedule('supply'), createRng(7), 3);
  assert.equal(draft.family, 'invasion');
  assert.equal(draft.cards.length, 6);
  assert.equal(new Set(draft.cards.map(card => card.id)).size, 6);
  const shop = generateDraft(forcedSchedule('shop'), createRng(18), 3);
  assert.equal(shop.family, 'invasion');
  assert.ok([...draft.cards, ...shop.cards].every(card => card.kind === 'invasion'));
  const cards = new Map([...draft.cards, ...shop.cards].map(card => [card.id, card]));
  const base = Object.values(INVASION_DATA.chess).find(record => record.chessId.startsWith('chess_mon_')
    && m.gd.mergeCount(record.chessId) === 3 && !m.chessExcluded(record));
  assert.ok(base);
  m.phase = 'PREP';
  m.bondChoice = null;
  buyer.funds = 0;
  buyer.shop.slots = [{ kind: 'chess', id: base.chessId, basePrice: 1 }];
  applyCard(m, buyer, cards.get('invasion_reinforcements'));
  assert.equal(buyer.buy(0).error, ERR.NO_FUNDS);
  const grant = buyer.acquireChess(base.chessId);
  assert.ok(grant);
  buyer.funds = 100;
  assert.equal(buyer.buy(0).ok, true);
  const reinforced = buyer.hand.find(piece => piece?.invasionExtraMembers === 1);
  assert.ok(reinforced);
  const elite = buyer.acquireChess(base.chessId);
  assert.ok(m.gd.isGolden(elite.id));
  assert.equal(elite.invasionExtraMembers, 1);
  buyer.board.set('2,2', elite);
  teammate.board.set('2,2', { ...elite, invasionExtraMembers: 0 });
  m._unitBattleStatsOf = () => new Map([[elite.uid, { maxHp: 100, atk: 100, def: 100 }]]);
  const before = m._monsterWavePayload(m._monsterLineup(buyer.seat)).spawns[0];
  applyCard(m, buyer, cards.get('invasion_drill'));
  const after = m._monsterWavePayload(m._monsterLineup(buyer.seat)).spawns[0];
  const other = m._monsterWavePayload(m._monsterLineup(teammate.seat)).spawns[0];
  assert.equal(after.count, 4);
  assert.equal(other.count, 3);
  for (const stat of ['maxHp', 'atk', 'def']) {
    assert.ok(Math.abs(after.stats[stat] / before.stats[stat] - 1.05) < 1e-9);
    assert.equal(other.stats[stat], before.stats[stat]);
  }
});

test('the two match engines leave round 14 with the same life totals and complementary results', (t) => {
  const mode = process.env.OPS_MODE;
  process.env.OPS_MODE = '1';
  const duel = createDuel();
  t.after(() => {
    if (mode === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = mode;
    removeDuel(duel);
  });
  const ops = makeAlliance({ humans: 4, fake: true });
  const invasion = makeInvasion({ humans: 4, fake: true, data: { ...INVASION_DATA, config: { ...INVASION_DATA.config, monsterOnly: true } } });
  t.after(() => { ops.m.dispose(); invasion.m.dispose(); });
  for (const side of [ops, invasion]) {
    side.m.opts.duel = duel;
    for (const player of side.m.alivePlayers()) player.lp = 10;
    side.m._startRoundAfterOffers(14);
  }
  for (let step = 0; step < 600 && (!ops.ended || !invasion.ended); step++) {
    if (!ops.ended) ops.sched.runNext();
    if (!invasion.ended) invasion.sched.runNext();
  }
  assert.equal(ops.ended?.roundsPassed, 14);
  assert.equal(invasion.ended?.roundsPassed, 14);
  assert.equal(ops.ended.victory, true);
  assert.equal(invasion.ended.victory, false);
  assert.deepEqual(ops.ended.duelPool, { ops: 40 });
  assert.deepEqual(invasion.ended.duelPool, ops.ended.duelPool);
  assert.ok(invasion.ended.players.every(player => player.lp == null && player.stats.lpLost === 0));
  assert.ok(invasion.m.publicView().players.every(player => player.lp == null));
  assert.ok(invasion.m.alivePlayers().every(player => player.privateView().lp == null));
  assert.deepEqual(ops.logs.error, []);
  assert.deepEqual(invasion.logs.error, []);
});

test('two concurrent eight-seat duels stay isolated through all 14 rounds', (t) => {
  const mode = process.env.OPS_MODE;
  process.env.OPS_MODE = '1';
  t.after(() => {
    if (mode === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = mode;
  });
  const matches = [9, 13].map((life) => {
    const duel = createDuel();
    const alliance = makeAlliance({ humans: 4, fake: true, captureFrames: false });
    const invasion = makeInvasion({ humans: 4, fake: true, captureFrames: false });
    t.after(() => { alliance.m.dispose(); invasion.m.dispose(); removeDuel(duel); });
    for (const side of [alliance, invasion]) {
      side.m.opts.duel = duel;
      for (const player of side.m.alivePlayers()) player.lp = life;
      side.m._startRoundAfterOffers(1);
    }
    return { alliance, invasion, duel, life };
  });
  const sides = matches.flatMap(({ alliance, invasion }) => [alliance, invasion]);
  for (let step = 0; step < 12_000 && sides.some((side) => !side.ended); step++) {
    for (const side of sides) if (!side.ended) side.sched.runNext();
  }
  for (const { alliance, invasion, duel, life } of matches) {
    for (let round = 1; round <= 14; round++) {
      assert.equal(readDuel(duel, `round-${round}-result`)?.pool.ops, life * 4);
      assert.equal(readDuel(duel, `round-${round}-lineups`)?.spawns.length, 4);
    }
    assert.equal(alliance.ended?.victory, true);
    assert.equal(invasion.ended?.victory, false);
    assert.deepEqual(alliance.ended.duelPool, invasion.ended.duelPool);
    assert.deepEqual(alliance.logs.error, []);
    assert.deepEqual(invasion.logs.error, []);
  }
});
