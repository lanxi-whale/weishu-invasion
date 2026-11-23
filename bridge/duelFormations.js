import { opsSeatFor, readDuel, writeDuel } from './duel.js';

const POLL_MS = 400;

function roster(match, camp, withFormation) {
  return match.order.map(player => {
    const formation = withFormation && player.alive ? {
      tiles: [...player.deployMap()].map(([position, kind]) => [...position.split(',').map(Number), kind]),
      devices: { ...player.deviceOverrides },
      units: match._prepBoardUnits(player).map(({ id, uid, kind, name, x, y, dir, defId, avatar, spine, golden, tier, maxHp, items, skin }) =>
        ({ id, uid, kind, name, x, y, dir, defId, avatar, spine, golden, tier, maxHp,
          ...(items ? { items: [...items] } : {}), ...(skin ? { skin } : {}) })),
      bonds: Object.entries(player.bondsView())
        .filter(([, bond]) => bond.count > 0 || bond.layers > 0)
        .map(([bondId, bond]) => {
          const record = match.gd.bond(bondId);
          return { bondId, ...bond, name: record?.name ?? bondId, thresholds: record?.thresholds ?? [] };
        }),
    } : null;
    return {
      seat: player.seat, playerId: player.playerId, name: player.name, isBot: player.isBot,
      alive: player.alive, connected: player.connected, ready: player.ready,
      bandId: player.bandId, leaderKey: camp === 'monster' ? match.gd.band(player.bandId)?.leaderKey ?? null : null,
      formation,
    };
  });
}

export function receiveDuelFormations(match, camp) {
  const otherCamp = camp === 'ops' ? 'monster' : 'ops';
  const snapshot = readDuel(match.opts.duel, `formation-${otherCamp}`);
  const previous = match._duelOpponentFormation;
  if (!snapshot || (snapshot.round === previous?.round && snapshot.revision === previous.revision)) return;
  match._duelOpponentFormation = snapshot;
  match.markPublic();
}

export function publishDuelFormations(match, camp, rect) {
  const players = roster(match, camp, true);
  const signature = JSON.stringify(players);
  const previous = match._duelLocalFormation;
  const round = match.round;
  if (previous?.round === round && previous.signature === signature) return;
  const map = previous?.map ?? formationMap(match.stage, rect, camp);
  const snapshot = { round, revision: (previous?.revision ?? 0) + 1, players, map };
  writeDuel(match.opts.duel, `formation-${camp}`, snapshot);
  match._duelLocalFormation = { ...snapshot, signature };
  match.markPublic();
}

function formationMap(stage, rect, camp) {
  if (!stage) return null;
  const { id, rows, tiles, devices, size, config, sceneId = id } = stage;
  return { rect, stage: { id: `duel-${camp}-${id}`, rows, tiles, devices, size, config, sceneId } };
}

export function duelFormationMaps(match, camp) {
  const otherCamp = camp === 'ops' ? 'monster' : 'ops';
  return { [camp]: match._duelLocalFormation?.map ?? null, [otherCamp]: match._duelOpponentFormation?.map ?? null };
}

export function startDuelFormationSync(match, camp, rect) {
  const round = match.round;
  const sync = () => {
    if (match.disposed || match.ended || match.round !== round || match.phase !== 'PREP') return;
    publishDuelFormations(match, camp, rect);
    receiveDuelFormations(match, camp);
    match.later(POLL_MS, sync);
  };
  sync();
}

export function duelMatchups(match, camp, lane) {
  const local = match._duelLocalFormation;
  const other = match._duelOpponentFormation;
  const localPlayers = local?.round === match.round ? local.players : roster(match, camp, false);
  const otherPlayers = other?.round === match.round ? other.players
    : (other?.players ?? []).map(player => ({ ...player, ready: false, formation: null }));
  const [attackers, defenders] = camp === 'monster' ? [localPlayers, otherPlayers] : [otherPlayers, localPlayers];
  return Array.from({ length: 4 }, (_, attackerSeat) => {
    const defenderSeat = opsSeatFor(attackerSeat, match.round);
    const attacker = attackers.find(player => player.seat === attackerSeat) ?? null;
    const defender = defenders.find(player => player.seat === defenderSeat) ?? null;
    const field = lane(attackerSeat, defender);
    return {
      attackerSeat, defenderSeat, attacker, defender,
      fieldId: field?.fieldId ?? null, gateLeaks: field?.gateLeaks ?? null,
    };
  });
}
