import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeMatch } from '../game/test/match/harness.js';
import { getVersionData } from '../game/server/data.js';
import { GameData } from '../game/server/match/gamedata.js';
import { createDataStore } from '../game/public/js/data.js';
import { validateC2S } from '../game/shared/protocol.js';
import { GameData as DefenseData } from '../game_ops/server/match/gamedata.js';
import { getVersionData as getDefenseData } from '../game_ops/server/data.js';
import { applyOpsWave, withBounties } from '../game_ops/server/match/waves.js';
import { DataSource } from '../game_ops/server/sim/simdata.js';
import { Battle } from '../game_ops/server/sim/Battle.js';

const version = 'act3autochess@V3_1';
const raw = getVersionData(version);
const defense = new DefenseData(getDefenseData(version), 'mode_multi_normal');
const slug = 'chess_mon_enemy_1007_slime';
const pomp = 'band_invasion_pompeii';

function open(t, band) {
  const h = makeMatch({ mode: 'coop', humans: 1, data: raw });
  t.after(() => h.m.dispose());
  h.start().toPrep(1, { band });
  const p = h.ps('p_0');
  assert.equal(p.bandId, band);
  return { m: h.m, p };
}

function deploy(p, entries) {
  p.board = new Map(entries.map(([pos, id], i) => [pos, { uid: 100 + i, kind: 'chess', id, items: [] }]));
  p.recompute();
}

function use(m, p, target) {
  const effectId = p.privateView().invasionCommand.effectId;
  const msg = { t: 'g.command', effectId, target };
  assert.equal(validateC2S(msg), null);
  return m.handle(p.playerId, msg);
}

test('the regulation draft exposes all 17 invasion strategies on both sides of the data store', () => {
  const gd = new GameData(raw, 'mode_multi_normal');
  const store = createDataStore();
  store.setContent({ id: version, values: { bands: raw.bands, config: raw.config, enemies: raw.enemies } });
  const ids = gd.bandIds();
  assert.equal(ids.length, 17);
  assert.ok(ids.includes(pomp));
  assert.deepEqual(store.list('bands').map(b => b.bandId).sort(), [...ids].sort());
  for (const id of ids) {
    const band = gd.band(id);
    assert.deepEqual(band, store.lookup('bands', id));
    assert.ok(band.invasionStrategy.title && band.invasionStrategy.desc, id);
    assert.deepEqual(band.buffs, [], id);
    assert.deepEqual(band.skills, [], id);
  }
  assert.equal(gd.band('band_copy').invasionStrategy.kind, 'cocoon');
  assert.equal(defense.band('band_copy').invasionStrategy, undefined);
  assert.equal(defense.band(pomp), null);
});

test('Pompeii adds one slug per deployed card and stacks with the seven-species tier', t => {
  const { m, p } = open(t, pomp);
  deploy(p, [['16,8', slug], ['16,9', slug + '_b'], ['13,8', 'chess_mon_enemy_1422_lrsldr']]);
  assert.deepEqual(p.privateView().invasionWave.map(s => s.count).sort(), [2, 3, 4]);
  const ids = [
    '1007_slime', '1021_bslime', '1067_snslime', '1305_mhslim', '1424_lrboom', '10001_trslim', '1132_sarchn',
  ].map(key => 'chess_mon_enemy_' + key);
  m.disabledBonds = [];
  deploy(p, ids.map((id, i) => [`16,${8 + i}`, id]));
  assert.deepEqual(p.privateView().invasionWave.map(s => s.count), Array(7).fill(9));
});

test('an accepted gate swap updates the preview and received route without changing spawn time', t => {
  const { m, p } = open(t, 'band_transfer');
  deploy(p, [['16,8', slug]]);
  const wave = () => m._monsterWavePayload(m._monsterLineup(p.seat));
  const before = p.privateView().invasionWave[0];
  assert.equal(before.gate, 'upper');
  assert.ok(use(m, p, { uid: 900 }).error);
  assert.equal(p.privateView().invasionCommand.usesLeft, 1);
  assert.ok(use(m, p, { uid: 100 }).ok);
  assert.ok(use(m, p, { uid: 100 }).error);
  const after = p.privateView().invasionWave[0];
  assert.deepEqual(after, { ...before, gate: 'lower' });
  const received = applyOpsWave({ routes: [] }, JSON.parse(JSON.stringify(wave())), defense);
  assert.deepEqual(received.routes[received.spawns[0].routeIndex].start, [9, 10]);
  assert.equal(received.spawns[0].time / defense.combatTimeScale, 1.2);
  assert.equal(received.spawns[0].interval / defense.combatTimeScale, 0.75);
});

test('Alliance red gates replay interleaved invasion entries with triple spacing', t => {
  const { m, p } = open(t, 'band_transfer');
  const slow = 'chess_mon_enemy_2002_bearmi';
  const fast = 'chess_mon_enemy_1041_lazerd';
  deploy(p, [['16,8', slow], ['13,9', fast]]);
  p.board.get('13,9').invasionExtraMembers = 2;
  const entries = p.privateView().invasionWave;
  assert.deepEqual(entries.map(s => [s.uid, s.batch, s.count, s.interval]), [[101, 2, 4, 0.25], [100, 1, 1, 0.25]]);
  assert.ok(Math.abs(entries[0].time - 2 / 1.5) < 0.001);
  assert.equal(entries[1].time, 2);
  const templateId = 'act3autochess_02';
  const base = { ...defense.wave(templateId), templateId, timeLimit: 60,
    actions: [{ index: 0, count: 3, valid: true }] };
  const payload = JSON.parse(JSON.stringify(m._monsterWavePayload(m._monsterLineup())));
  const wave = applyOpsWave(base, payload, defense);
  const spawns = withBounties(defense, 1, wave, [], 'blue');
  const withBounty = withBounties(defense, 1, wave, [{
    id: 'test-bounty', card: { enemyKey: 'enemy_1007_slime', count: 1, coin: 1 },
  }], 'blue');
  assert.ok(withBounty.some(s => s.tag === 'bounty'));
  assert.deepEqual(withBounty.filter(s => s.tag !== 'bounty'), spawns);
  const battle = new Battle({ seed: 1, kind: 'normal', round: 1, stageId: 'act3autochess_m05',
    timeLimit: 60, players: [], content: 'none', data: new DataSource(defense.raw), routes: wave.routes, spawns });
  const seen = [];
  battle.on('enemySpawn', ({ enemy }) => seen.push([battle.time / defense.combatTimeScale, enemy.defId, enemy.spawnY]));
  while (battle.time < 5 * defense.combatTimeScale) battle.step();
  const expected = entries.flatMap(s => Array.from({ length: s.count }, (_, i) => [
    1.2 + (s.time - entries[0].time + i * s.interval) * 3,
    s.enemyKey, s.gate === 'upper' ? 12 : 9,
  ])).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(seen.map(([, ...rest]) => rest), expected.map(([, ...rest]) => rest));
  seen.forEach(([time], i) => assert.ok(Math.abs(time - expected[i][0]) <= 1 / (30 * defense.combatTimeScale) + 1e-8));
});

test('advancing a later batch moves up to its first three while preserving every creature', t => {
  const { m, p } = open(t, 'band_jenga');
  deploy(p, [['16,8', slug], ['16,11', slug + '_b'], ['13,10', slug]]);
  p.board.get('16,11').invasionExtraMembers = 2;
  const before = p.privateView().invasionWave;
  const first = before.find(s => s.uid === 100);
  const later = before.find(s => s.uid === 101);
  p.funds = 0;
  assert.ok(use(m, p, { uid: 100, otherUid: 101 }).error);
  p.funds = 2;
  assert.ok(use(m, p, { uid: 100, otherUid: 102 }).error);
  assert.equal(p.funds, 2);
  assert.ok(use(m, p, { uid: 100, otherUid: 101 }).ok);
  assert.equal(p.funds, 1);
  assert.deepEqual(p.privateView().invasionWave.filter(s => s.uid === 101), [
    { ...later, count: 3, time: first.time, batch: first.batch },
    { ...later, count: 2, time: later.time + 3 * 0.25 },
  ]);
  m.round++;
  assert.equal(p.privateView().invasionCommand.usesLeft, 1);
  assert.equal(p.privateView().invasionWave.find(s => s.uid === 101).count, 5);
});

test('combat descriptors reach the defense field and a passive does not mark other selections', t => {
  const { m, p } = open(t, 'band_copy');
  deploy(p, [['16,8', slug]]);
  const wave = m._monsterWavePayload(m._monsterLineup());
  const received = applyOpsWave({ routes: [] }, JSON.parse(JSON.stringify(wave)), defense);
  assert.deepEqual(received.spawns[0].invasion, { kind: 'cocoon', gate: 'upper' });
  p.bandId = 'band_transfer';
  assert.equal(m._monsterWavePayload(m._monsterLineup()).spawns[0].invasion, undefined);
});
