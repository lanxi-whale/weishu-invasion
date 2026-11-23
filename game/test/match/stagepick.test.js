// 4v4 (2026-11-17): every difficulty draws one of ten official regulation maps
// using the match seed. The selected map stays in use for the whole match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves } from '../../server/match/waves.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';
import { DATA, makeMatch } from './harness.js';

// 4v4 owner request: every difficulty rotates all ten decoded official maps.
const [M01, ...REST] = DATA.config.mapRotation;
const pick = (modeId, seed) => setupMatchWaves(new GameData(DATA, modeId), createRng(deriveSeed(seed >>> 0, 'setup'))).stageId;

test('all difficulty lists contain the ten official maps, all weight 50', () => {
  const stagesOf = (m) => DATA.config.modes[m].stages.slice().sort();
  for (const t of ['single', 'multi']) {
    assert.deepEqual(stagesOf(`mode_${t}_funny`), [M01, ...REST].sort(), `${t} 标准`);
    assert.deepEqual(stagesOf(`mode_${t}_normal`), [M01, ...REST].sort(), `${t} 险境`);
    assert.deepEqual(stagesOf(`mode_${t}_hard`), [M01, ...REST].sort(), `${t} 绝境`);
    assert.deepEqual(stagesOf(`mode_${t}_abyss`), [M01, ...REST].sort(), `${t} 终极`);
  }
  assert.deepEqual(stagesOf('mode_training_1'), [M01, ...REST].sort());
  for (const id of [M01, ...REST]) assert.ok(DATA.stages[id].active && DATA.stages[id].weight === 50, id);
});

test('every difficulty picks uniformly among the official maps with the match seed', () => {
  const N = 1600;
  for (const t of ['single', 'multi']) {
    for (const d of ['funny', 'normal', 'hard', 'abyss']) {
      const modeId = `mode_${t}_${d}`;
      const list = DATA.config.modes[modeId].stages;
      const count = new Map(list.map((s) => [s, 0]));
      for (let i = 0; i < N; i++) {
        const s = pick(modeId, Math.imul(i + 1, 2654435761));
        assert.ok(count.has(s), `${modeId}: ${s}`);
        count.set(s, count.get(s) + 1);
      }
      const exp = N / list.length;
      for (const [s, n] of count) assert.ok(n > exp * 0.75 && n < exp * 1.25, `${modeId} ${s}: ${n} of ${N} (uniform ≈ ${exp.toFixed(0)})`);
    }
  }
});

test('different match seeds give different stages (no fixed map), the same seed the same stage', () => {
  // consecutive lobby seeds are independent uint32 draws: 3 matches in a row on one stage is ~1/64 in 险境
  let same3 = 0, runs = 0;
  for (let i = 0; i < 300; i += 3, runs++) {
    const a = pick('mode_multi_normal', i * 104729 + 17), b = pick('mode_multi_normal', (i + 1) * 104729 + 17), c = pick('mode_multi_normal', (i + 2) * 104729 + 17);
    if (a === b && b === c) same3++;
  }
  assert.ok(same3 <= 6, `${same3} of ${runs} triples on one stage`);
  const first10 = new Set(Array.from({ length: 10 }, (_, i) => pick('mode_single_hard', 1000 + i)));
  assert.ok(first10.size >= 4, `${first10.size} stages over 10 seeds`);
  assert.equal(pick('mode_multi_abyss', 424242), pick('mode_multi_abyss', 424242));
});

test('Match chooses once from the seed in cooperative and solo modes at every difficulty', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed, fake: true });
    assert.equal(h.m.stageId, pick('mode_multi_normal', seed), `seed ${seed}`);
    seen.add(h.m.stageId);
  }
  assert.ok(seen.size >= 4, `${seen.size} stages over 12 co-op 险境 matches`);
  const solo = new Set();
  for (let seed = 1; seed <= 12; seed++) solo.add(makeMatch({ mode: 'solo', difficulty: 'HARD', seed, fake: true }).m.stageId);
  assert.ok(solo.size >= 4, `solo 绝境: ${[...solo].join(' ')}`);
  const funny = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed, fake: true });
    funny.add(h.m.stageId);
    h.m.dispose();
  }
  assert.ok(funny.size >= 4, 'standard mode also rotates maps');
});
