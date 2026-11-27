import { mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DUEL_ROUNDS = 14;

export function createDuel() {
  return { id: randomUUID(), directory: mkdtempSync(join(tmpdir(), 'sp-4v4-')) };
}

export function removeDuel(duel) {
  for (const file of readdirSync(duel.directory)) unlinkSync(join(duel.directory, file));
  rmdirSync(duel.directory);
}

export function monsterSeatFor(opsSeat, round) {
  return (opsSeat + (round - 1)) % 4;
}

export function opsSeatFor(monsterSeat, round) {
  return (monsterSeat + 4 - (round - 1) % 4) % 4;
}

export function invasionBountyWinners(results) {
  const winners = new Set();
  for (const result of results) {
    for (const leak of result?.leaked || []) {
      if (leak.invasionSiegeBounty) winners.add(leak.sourcePlayerId);
    }
  }
  return [...winners];
}

export function duelSource(duel, round, streamKey) {
  return `${duel.id}:${round}:${streamKey}`;
}

export function writeDuel(duel, key, message) {
  const path = join(duel.directory, `${key}.json`);
  const staging = `${path}.${randomUUID()}.tmp`;
  writeFileSync(staging, JSON.stringify(message), 'utf8');
  renameSync(staging, path);
}

export function readDuel(duel, key) {
  try { return JSON.parse(readFileSync(join(duel.directory, `${key}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function waitForDuel(match, key, receive, timeoutMs = 240_000) {
  const duel = match.opts.duel;
  const round = match.round;
  const until = Date.now() + timeoutMs;
  const poll = () => {
    if (match.ended || match.disposed || match.round !== round) return;
    const message = readDuel(duel, key);
    if (message) { receive(message); return; }
    const cancel = readDuel(duel, 'cancel');
    if (cancel || Date.now() >= until) {
      match.finish({ victory: false, reason: 'duel-aborted' });
      return;
    }
    match.later(100, poll);
  };
  poll();
}

export function startDuelPrepClock(match, camp) {
  const { round } = match;
  const duel = match.opts.duel;
  const other = camp === 'ops' ? 'monster' : 'ops';
  const seconds = Math.round(40 + 70 * (round - 1) / (DUEL_ROUNDS - 1));
  const arrived = { at: match.sched.now(), durationMs: match.scaled(seconds * 1000) };

  writeDuel(duel, `round-${round}-prep-${camp}`, arrived);
  waitForDuel(match, `round-${round}-prep-${other}`, (opponent) => {
    if (match.phase !== 'PREP') return;
    // Start when both camps have reached prep. Both use the defending host's duration.
    const durationMs = camp === 'ops' ? arrived.durationMs : opponent.durationMs;
    const deadline = Math.max(arrived.at, opponent.at) + durationMs;
    match._duelPrepClock = { round, deadline, seconds: durationMs / 1000 };
    if (match._duelSealedRound !== round) {
      match.setDeadline(seconds, () => match.prepDeadline(), { at: deadline });
    }
    match.markPublic();
  });
}

export function duelPrepView(match) {
  if (match.phase !== 'PREP') return {};
  const clock = match._duelPrepClock?.round === match.round ? match._duelPrepClock : null;
  const waiting = match._duelSealedRound === match.round;
  const deadline = waiting ? clock?.deadline ?? 0 : match.deadline;
  return {
    deadline,
    ...(waiting ? { duelWaiting: true } : {}),
    ...(deadline > 0 && clock ? { prepSeconds: clock.seconds } : {}),
  };
}

export function defenseLife(players) {
  return players.reduce((sum, player) => sum + Math.max(0, player.lp), 0);
}

export function duelRound(players, gateLeaks, round) {
  const life = defenseLife(players);
  const through = players.reduce((sum, player) => sum + (gateLeaks[player.playerId] || 0), 0);
  const damage = Math.min(life, through, players.length * 10);
  const losses = Object.fromEntries(players.map(player => [player.playerId, 0]));
  let remaining = damage;
  for (const player of players) {
    const loss = Math.min(remaining, Math.max(0, player.lp), gateLeaks[player.playerId] || 0);
    losses[player.playerId] = loss;
    remaining -= loss;
  }
  for (const player of players) {
    if (remaining === 0) break;
    const loss = Math.min(remaining, Math.max(0, player.lp) - losses[player.playerId]);
    losses[player.playerId] += loss;
    remaining -= loss;
  }
  const ops = life - damage;
  const winner = ops === 0 ? 'monster' : round >= DUEL_ROUNDS ? 'ops' : null;
  return { pool: { ops }, losses, final: winner !== null, winner };
}

export function advanceDuel(match, camp) {
  const result = match._duelResult;
  if (!result?.final) return false;
  match.finish({ victory: result.winner === camp, reason: 'duel-finished' });
  return true;
}
