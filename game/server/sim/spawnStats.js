// The immutable preparation attributes that follow one monster through 联防.
const KEYS = ['maxHp', 'atk', 'def', 'res', 'aspd', 'bat', 'moveSpeed', 'hpRecoveryPerSec'];

export function spawnStats(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const key of KEYS) {
    const n = value[key];
    if (Number.isFinite(n) && (key === 'hpRecoveryPerSec' || (['maxHp', 'aspd', 'bat'].includes(key) ? n > 0 : n >= 0))) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

export function sameSpawnStats(a, b) {
  const x = spawnStats(a), y = spawnStats(b);
  return KEYS.every((key) => x?.[key] === y?.[key]);
}
