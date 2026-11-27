import { COLS } from '../constants.js';
import { tileKeyOf } from '../targeting.js';

const FIRST_CONTROL = new Set(['stun', 'freeze', 'bind']);
const REVIVED_OFFSPRING = new Set(['death', 'split', 'seabornSplit', 'revive']);
const NORMAL_DAMAGE = new Set(['phys', 'arts', 'true', 'elemental']);
const FLIGHT_BUFF = 'invasion:subFly';
const REFLECTION_SLOW = 'reg:refslow';
const DOT_MULTIPLIER = [1, 1.15, 1.3];

export function invasionDotMultiplier(enemy) {
  return DOT_MULTIPLIER[enemy?.invasionBonds?.tiers?.mon_sub_dot ?? 0] ?? 1;
}

export function installInvasionSubBonds(battle, api) {
  const firstControl = new WeakSet();
  const flightTimers = new WeakMap();
  const rebornTimers = new WeakMap();
  const reflected = new WeakSet();
  const reflectionReady = new WeakMap();

  function resetFlight(enemy) {
    const tier = api.tier(enemy, 'mon_sub_fly');
    if (!tier || !enemy.alive) return;
    flightTimers.get(enemy)?.cancel();
    battle.removeBuff(enemy, FLIGHT_BUFF);
    flightTimers.set(enemy, battle.after(3, () => {
      flightTimers.delete(enemy);
      if (enemy.alive) battle.addBuff(enemy, { key: FLIGHT_BUFF, mods: { moveMul: tier === 2 ? 1.25 : 1.15 } });
    }, { owner: enemy }));
  }

  function startRecovery(enemy) {
    const tier = api.tier(enemy, 'mon_sub_reborn');
    if (!tier || !enemy.alive) return;
    const fraction = tier === 2 ? 0.07 : 0.04;
    rebornTimers.get(enemy)?.cancel();
    rebornTimers.set(enemy, battle.every(1, (_, timer) => {
      if (!enemy.alive || timer.count === 5) {
        timer.cancel();
        rebornTimers.delete(enemy);
      }
      if (enemy.alive) battle.heal({ source: enemy, target: enemy, amount: enemy.s.maxHp * fraction, mode: 'regen' });
    }, { owner: enemy }));
  }

  battle.on('enemySpawn', ({ enemy, offspringKind }) => {
    resetFlight(enemy);
    const trigger = offspringKind ?? enemy.invasionBonds?.offspringKind;
    if (REVIVED_OFFSPRING.has(trigger) || enemy.invasionBonds?.revived) startRecovery(enemy);
  }, { priority: -100 });

  battle.on('enemyReborn', ({ enemy }) => {
    if (!enemy.invasionBonds) return;
    enemy.invasionBonds = { ...enemy.invasionBonds, revived: true };
    startRecovery(enemy);
  });

  battle.on('beforeStatus', (ctx) => {
    const { target, status } = ctx;
    if (ctx.cancel || !FIRST_CONTROL.has(status) || firstControl.has(target)) return;
    const tier = api.tier(target, 'mon_sub_special');
    if (tier) ctx.duration *= tier === 2 ? 0.55 : 0.75;
  }, { priority: -100 });

  // Immunity and cancellation can refuse the shortened status. Only a successful application uses the protection.
  battle.on('statusApplied', ({ target, status }) => {
    if (FIRST_CONTROL.has(status) && api.tier(target, 'mon_sub_special')) firstControl.add(target);
  }, { priority: 100 });

  battle.on('block', ({ target, cancelled }) => {
    if (cancelled) resetFlight(target);
  });

  battle.on('damageApplied', ({ source, target, dmg, hpRemoved }) => {
    if (hpRemoved > 0) resetFlight(target);
    const tier = api.tier(target, 'mon_sub_reflection');
    if (!tier || dmg.type !== 'arts' || reflected.has(target) || !target.findBuff('ab:refraction') || target.s.flags.silence) return;
    if (source?.side !== 'ally' || !source.alive || !source.deployed || battle.time < (reflectionReady.get(source) ?? 0) - 1e-9) return;
    reflected.add(target);
    reflectionReady.set(source, battle.time + 6);
    battle.applyStrongest(source, REFLECTION_SLOW, {
      source: target, duration: 3, value: tier === 2 ? -25 : -15, mods: aspd => ({ aspd }),
    });
  });

  battle.on('elementHit', ({ source, target, dmg }) => {
    if (target.side !== 'ally' || !dmg.tags.includes('enemyAbility') || dmg.tags.includes('invasionBond')) return;
    const tier = api.tier(source, 'mon_sub_element');
    if (tier) dmg.mul *= tier === 2 ? 1.25 : 1.15;
  });

  battle.on('damageOutput', (ctx) => {
    const { source, target, dmg } = ctx;
    if (target.side !== 'ally' || target.hpRatio >= 0.35 || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    const tier = api.tier(source, 'mon_sub_critic');
    if (tier) ctx.amount *= tier === 2 ? 1.25 : 1.15;
  });

  // This also observes scripted blockers that report the normal blocked event.
  battle.on('blocked', ({ enemy }) => battle._observeEnemyStealth(enemy), { priority: 1000 });
  battle.on('enemyStealthChanged', ({ enemy }) => {
    const tier = api.tier(enemy, 'mon_sub_invisible');
    if (!tier) return;
    const attackType = enemy.mem.ab?.atkType ?? enemy.profile?.dmgType ?? enemy.def?.dmgType;
    const type = NORMAL_DAMAGE.has(attackType) ? attackType : 'phys';
    const amount = enemy.s.atk * (tier === 2 ? 1.5 : 1);
    const tile = tileKeyOf(enemy);
    if (tile < 0 || !(amount > 0)) return;
    const row = Math.floor(tile / COLS), col = tile % COLS;
    const neighbors = battle.allyUnits.filter(target => {
      if (!target.alive || !target.deployed || target.hidden) return false;
      return Math.max(Math.abs(target.tileR - row), Math.abs(target.tileC - col)) === 1;
    });
    for (const target of neighbors) {
      battle.dealDamage({ source: enemy, target, amount, type, attackType: 'SPLASH',
        ignoreSelect: true, tags: ['invasionBond', 'invisible'] });
    }
  }, { priority: -100 });
}
