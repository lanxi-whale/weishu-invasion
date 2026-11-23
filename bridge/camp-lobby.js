import { randomBytes } from 'node:crypto';
import { createDuel, removeDuel, writeDuel } from './duel.js';

const CAMPS = ['ops', 'monster'];
const EMPTY_TEAM = Object.freeze(Array(4).fill(null));
const SEAT_TRANSFER_MS = 30_000;

function seats(room) {
  return room?.seats.map(seat => seat && !seat.left ? {
    seat: seat.seat,
    playerId: seat.playerId,
    name: seat.name,
    isBot: seat.isBot,
    ready: seat.ready,
    connected: seat.connected,
  } : null) ?? EMPTY_TEAM;
}

function ready(group) {
  return !group.duel && CAMPS.every(camp => {
    const room = group.rooms[camp];
    return room && !room.match && !room.versionVote && room.seats.every(seat =>
      seat && !seat.left && (seat.isBot || (seat.connected &&
        (seat.ready || (camp === group.hostCamp && seat.playerId === room.hostId)) &&
        (!room.needsContent || seat.content === 'ready') &&
        (!room.content?.trusted || seat.consentCs === room.content.cs))));
  });
}

function closeDuel(group) {
  const duel = group.duel;
  group.duel = null;
  if (duel) removeDuel(duel);
}

export function connectCampLobbies(ops, monster) {
  const lobbies = { ops, monster };
  const groups = new Map();
  const tickets = new Map();
  const pendingTicket = new WeakMap();

  function transferProblem(sourceCamp, room, session, targetCamp, seat, errors) {
    const source = lobbies[sourceCamp];
    const group = room.campGroup;
    if (!group || !CAMPS.includes(targetCamp) || targetCamp === sourceCamp ||
        !Number.isInteger(seat) || seat < 0 || seat >= EMPTY_TEAM.length) return { error: errors.BAD_TARGET };
    if (source.registry.byId(session.playerId) !== session || source.roomOf(session) !== room) {
      return { error: errors.NOT_IN_ROOM };
    }
    const target = group.rooms[targetCamp];
    if (group.duel || room.match || target?.match) return { error: errors.ROOM_STARTED };
    if (target?.seats[seat]) return { error: errors.BAD_TARGET, detail: 'seat occupied' };
    if (!target && !lobbies[targetCamp].versionEnabled(room.version)) return { error: errors.VERSION_UNKNOWN };
    if (!target && lobbies[targetCamp].rooms.size >= lobbies[targetCamp].opts.maxRooms) return { error: errors.ROOM_FULL };
    return null;
  }

  for (const camp of CAMPS) {
    const rival = camp === 'ops' ? 'monster' : 'ops';
    const peer = lobbies[rival];
    lobbies[camp].campRooms = {
      hasPeerCode: code => peer.rooms.has(code),
      joinable: code => groups.get(code)?.rooms[rival],
      attach(room, source) {
        const group = source?.campGroup ?? { rooms: {}, hostCamp: camp };
        groups.set(room.code, group);
        group.rooms[camp] = room;
        room.campGroup = group;
        room.campState = () => ({
          camp,
          hostCamp: group.hostCamp,
          hostId: group.rooms[group.hostCamp]?.hostId ?? null,
          ready: ready(group),
          teams: { ops: seats(group.rooms.ops), monster: seats(group.rooms.monster) },
        });
      },
      transferSeat(room, session, targetCamp, seat, errors) {
        const problem = transferProblem(camp, room, session, targetCamp, seat, errors);
        if (problem) return problem;
        const previous = pendingTicket.get(session);
        if (previous) tickets.delete(previous);
        const campTicket = randomBytes(16).toString('hex');
        tickets.set(campTicket, { room, session, targetCamp, seat, expires: Date.now() + SEAT_TRANSFER_MS });
        pendingTicket.set(session, campTicket);
        setTimeout(() => tickets.delete(campTicket), SEAT_TRANSFER_MS).unref();
        return { ok: true, campTicket };
      },
      claimSeat(campTicket, errors) {
        const ticket = tickets.get(campTicket);
        if (ticket?.targetCamp !== camp || ticket.expires <= Date.now()) return { error: errors.BAD_TARGET, detail: 'camp transfer expired' };
        const targetLobby = lobbies[camp];
        if (ticket.arrived) {
          // If the first welcome was lost, the same navigation can resume its disconnected session.
          const arrived = ticket.arrived;
          return !arrived.connected && targetLobby.registry.byId(arrived.playerId) === arrived
            && targetLobby.roomOf(arrived) === ticket.room.campGroup.rooms[camp]
            ? { session: arrived } : { error: errors.BAD_TARGET, detail: 'camp transfer expired' };
        }
        const { room, session, seat } = ticket;
        const problem = transferProblem(rival, room, session, camp, seat, errors);
        if (problem) { tickets.delete(campTicket); return problem; }
        const next = targetLobby.registry.create(session.name, session.playerId);
        if (!next) return { error: errors.SERVER_FULL };

        const group = room.campGroup;
        const targetRoom = group.rooms[camp] ?? targetLobby.createCampProjection(room);
        const newSeat = targetLobby.humanSeat(seat, next, targetRoom);
        if (targetRoom.versionVote) targetLobby.voidVersionVote(targetRoom, 'members');
        targetRoom.seats[seat] = newSeat;
        next.roomCode = room.code;
        if (group.hostCamp === rival && room.hostId === session.playerId) {
          group.hostCamp = camp;
          targetRoom.hostId = next.playerId;
        } else if (!targetRoom.hostId) targetRoom.hostId = next.playerId;

        if (session.ws) peer.network?.detachReplaced(session.ws);
        peer.removeMember(room, session.playerId, { keepRoom: true });
        peer.registry.remove(session);
        ticket.arrived = next;
        return { session: next };
      },
      start(room, session, errors) {
        const group = room.campGroup;
        if (camp !== group.hostCamp) return { error: errors.NOT_HOST };
        if (!ready(group)) return { error: errors.NOT_READY };
        const other = group.rooms[rival];
        const otherHost = peer.registry.byId(other.hostId);
        if (other.activeHumans().length) {
          if (!otherHost) return { error: errors.NOT_READY };
          const validation = peer.validateStart(other, otherHost);
          if (!validation.ok) return validation;
        }
        const duel = createDuel();
        group.duel = duel;
        const local = lobbies[camp];
        const first = local.startMatch(room, session.limitKey || null, duel, true);
        const second = first.ok ? peer.startMatch(other, otherHost?.limitKey || null, duel, true) : first;
        if (!second.ok) {
          if (first.ok) local.onMatchEnd(room, room.matchCtx, { reason: 'duel-aborted' });
          else closeDuel(group);
          return second;
        }
        for (const side of CAMPS) {
          const member = group.rooms[side];
          lobbies[side].broadcastState(member);
          try { member.match.start(); }
          catch (error) {
            lobbies[side].log.error(`[4v4] ${member.code} failed to start`, error);
            for (const started of CAMPS) {
              const projection = group.rooms[started];
              if (projection?.matchCtx) lobbies[started].onMatchEnd(projection, projection.matchCtx, { reason: 'duel-aborted' });
            }
            return { error: errors.INTERNAL };
          }
        }
        return second;
      },
      changeBot(room, session, targetCamp, seat, removing, errors) {
        const group = room.campGroup;
        if (!group || !CAMPS.includes(targetCamp) || (seat !== undefined && (!Number.isInteger(seat) || seat < 0 || seat >= EMPTY_TEAM.length))) {
          return { error: errors.BAD_TARGET };
        }
        if (group.hostCamp !== camp || room.hostId !== session.playerId) return { error: errors.NOT_HOST };
        if (group.duel || room.match || group.rooms[targetCamp]?.match) return { error: errors.ROOM_STARTED };
        const targetLobby = lobbies[targetCamp];
        let target = group.rooms[targetCamp];
        if (!target) {
          if (removing) return { error: errors.BAD_TARGET };
          target = targetLobby.createCampProjection(room);
        }
        lobbies[camp].dropReplay(room, session.playerId);
        return removing ? targetLobby.removeBotSeat(target, seat) : targetLobby.addBotSeat(target, seat);
      },
      keepBots(room) {
        const other = room.campGroup?.rooms[rival];
        return !!other?.activeHumans().length && room.seats.some(seat => seat?.isBot);
      },
      ended(room, reason) {
        const group = room.campGroup;
        if (!group?.duel) return;
        if (!group.rooms[rival]?.match) closeDuel(group);
        else if (reason !== 'duel-finished') writeDuel(group.duel, 'cancel', { camp });
      },
      broadcast(room) {
        const other = room.campGroup?.rooms[rival];
        if (other) peer.emitRoomState(other, false);
      },
      detach(room) {
        const group = room.campGroup;
        if (!group) return;
        this.ended(room, 'abandoned');
        delete group.rooms[camp];
        const other = group.rooms[rival];
        if (!other) {
          groups.delete(room.code);
          return;
        }
        if (!other.activeHumans().length) {
          peer.disposeRoom(other, 'empty');
          return;
        }
        group.hostCamp = rival;
        peer.emitRoomState(other, false);
      },
    };
  }
}

