import { ERR, PHASE } from '../../shared/constants.js';
import { fail, OK } from './match/common.js';

const gates = ['upper', 'lower'];

export function currentInvasionOrder(player) {
  const order = player?.invasionOrder;
  return order?.round === player?.m?.round ? order : null;
}

function commandOptions(strategy, spawns) {
  if (strategy.targetType === 'gate') return { gateOptions: gates.filter(gate =>
    spawns.some(s => s.preview.gate === gate && !s.preview.fly)) };
  if (strategy.targetType === 'pair') {
    const eligiblePairs = [];
    for (const first of spawns) {
      for (const later of spawns) {
        if (first.preview.gate === later.preview.gate && first.batch < later.batch && first.time < later.time) {
          eligiblePairs.push({ uid: first.uid, otherUid: later.uid });
        }
      }
    }
    return { eligiblePairs };
  }
  const eligibleUids = spawns.filter(s => (strategy.unitType !== 'ground' || !s.preview.fly)
    && (strategy.unitType !== 'ranged' || s.attackType === 'RANGED')).map(s => s.uid);
  return { eligibleUids };
}

export function invasionCommandView(player, spawns) {
  const band = player.gd.band(player.bandId);
  const strategy = band?.invasionStrategy;
  if (!strategy?.active) return null;
  const { kind, targetType, cost } = strategy;
  const unlockRound = strategy.unlockRound ?? 1;
  const order = currentInvasionOrder(player);
  const options = commandOptions(strategy, spawns);
  const usesLeft = !order && player.m.round >= unlockRound ? 1 : 0;
  const reason = player.m.round < unlockRound ? 'locked'
    : order ? 'used'
      : player.ready || !player.alive || player.m.phase !== PHASE.PREP ? 'phase'
        : player.funds < cost ? 'funds'
          : Object.values(options)[0].length === 0 ? 'targets' : null;
  return { effectId: band.effectId, kind, targetType, cost, unlockRound, usesLeft, reason,
    title: strategy.title, desc: strategy.desc, ...options, target: order?.target ?? null };
}

export function useInvasionCommand(player, effectId, target) {
  const gate = player._gate();
  if (gate) return gate;
  const spawns = player.m._baseMonsterSpawns(player.m._monsterLineup(player.seat));
  const command = invasionCommandView(player, spawns);
  if (!command || command.effectId !== effectId || !target || typeof target !== 'object') return fail(ERR.BAD_TARGET);
  if (command.reason) return fail(command.reason === 'funds' ? ERR.NO_FUNDS : ERR.BAD_TARGET);
  const targets = command.gateOptions?.map(gate => ({ gate }))
    ?? command.eligibleUids?.map(uid => ({ uid })) ?? command.eligiblePairs;
  const selection = targets.find(option => Object.keys(option).length === Object.keys(target).length
    && Object.entries(option).every(([key, value]) => target[key] === value));
  if (!selection) return fail(ERR.BAD_TARGET);
  const { round } = player.m;
  player.spend(command.cost);
  player.invasionOrder = { round, kind: command.kind, target: selection };
  player._afterSpend(command.cost, 'command');
  player.m._publishMonsterLineup(true);
  return OK;
}
