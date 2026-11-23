import { BLOCK_RADIUS_SQ, COLS, MOVE_SCALE } from './constants.js';
import { straightClear } from './grid.js';
import { hypot } from './detmath.js';
import { canTargetEnemy } from './targeting.js';

const ADJACENT = [[-1, 0], [0, -1], [0, 1], [1, 0]];

/** A unit born on impassable terrain can step off onto a reachable adjacent tile. */
function nextTile(grid, unit, field) {
  const { tileR: row, tileC: col } = unit;
  const key = row * COLS + col;
  if (field.dist[key] >= 0) return key === field.dest ? key : field.next[key];
  let best = -1, distance = Infinity;
  for (const [dr, dc] of ADJACENT) {
    const r = row + dr, c = col + dc;
    if (!grid.groundPassable(r, c)) continue;
    const to = r * COLS + c;
    if (field.dist[to] < 0 || field.dist[to] >= distance) continue;
    best = to;
    distance = field.dist[to];
  }
  return best;
}

/** Walk toward a selectable ground enemy. Equal taunt uses nearest first, then spawn order [ASSUMED]. */
export function updateMobileAlly(battle, unit, dt) {
  unit.moving = false;
  const speed = unit.s.moveSpeed * MOVE_SCALE;
  if (!unit.canAct || unit.s.flags.noMove || unit.blocking.length || speed <= 0) return;
  const { grid } = battle;
  let target = null, step = -1, bestTaunt = -Infinity, bestDistance = Infinity;
  for (const enemy of battle.enemies) {
    if (enemy.isFlying || !canTargetEnemy(unit, enemy, null)) continue;
    const taunt = enemy.s.taunt;
    const dx = enemy.x - unit.x, dy = enemy.y - unit.y;
    const distance = dx * dx + dy * dy;
    if (taunt < bestTaunt || (taunt === bestTaunt && distance >= bestDistance)) continue;
    const row = Math.round(enemy.y), col = Math.round(enemy.x);
    if (!grid.groundPassable(row, col)) continue;
    const next = nextTile(grid, unit, grid.flowField(row, col, { allowDiagonal: false, blockCrates: true }));
    if (next < 0 || !grid.groundPassable((next / COLS) | 0, next % COLS)) continue;
    target = enemy;
    step = next;
    bestTaunt = taunt;
    bestDistance = distance;
  }
  if (!target) return;
  const tile = { x: step % COLS, y: (step / COLS) | 0 };
  const sameTile = tile.x === unit.tileC && tile.y === unit.tileR;
  const goal = sameTile ? target : straightClear(grid, unit.x, unit.y, tile) ? tile : { x: unit.tileC, y: unit.tileR };
  const dx = goal.x - unit.x, dy = goal.y - unit.y;
  const distance = hypot(dx, dy);
  if (distance <= 1e-9) return;
  const fraction = Math.min(1, speed * dt / distance);
  unit.x += dx * fraction;
  unit.y += dy * fraction;
  const col = Math.round(unit.x), row = Math.round(unit.y);
  const dir = Math.abs(dx) > 1e-9 ? (dx < 0 ? 'LEFT' : 'RIGHT') : unit.dir;
  if (col !== unit.tileC || row !== unit.tileR || dir !== unit.dir) {
    unit.tileC = col;
    unit.tileR = row;
    unit.dir = dir;
    battle.refreshRange(unit);
  }
  unit.moving = true;
  // The enemy phase already ran. Check contact here as well so the summon stops on the frame it reaches an enemy.
  for (const enemy of battle.enemies) {
    if (!enemy.alive || enemy.blockedBy || enemy.isFlying) continue;
    const x = enemy.x - unit.x, y = enemy.y - unit.y;
    if (x * x + y * y < BLOCK_RADIUS_SQ.ground) battle._checkBlock(enemy);
  }
}
