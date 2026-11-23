import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getVersionData } from '../game_ops/server/data.js';
import { GameData } from '../game_ops/server/match/gamedata.js';
import { setupMatchWaves } from '../game_ops/server/match/waves.js';
import { createRng } from '../game_ops/server/sim/rng.js';
import { makeMatch } from '../game/test/match/harness.js';
import { SoloOpponent } from '../bridge/soloOpponent.js';
import { VERSIONS } from '../game_ops/shared/versions.js';
import { parseSceneChunks } from '../game/public/js/render/board3d/load.js';
import { fieldStage, invasionPrepCamera, INVASION_PREP_RECT } from '../game/public/js/render/app/view.js';
import { invasionPrepCamera as invasionCameraFromAlliance } from '../game_ops/public/js/render/app/view.js';

const root = new URL('../', import.meta.url);
const json = (rel) => JSON.parse(fs.readFileSync(new URL(rel, root), 'utf8'));

test('every version and difficulty draws from ten maps, reproducibly and with variety', () => {
  for (const version of VERSIONS) {
    const raw = getVersionData(version.id);
    const ids = raw.config.mapRotation;
    assert.equal(ids.length, 10);
    for (const modeId of Object.keys(raw.config.modes)) {
      const gd = new GameData(raw, modeId);
      const seen = new Set();
      for (let seed = 1; seed <= 64; seed++) {
        const id = setupMatchWaves(gd, createRng(seed)).stageId;
        assert.ok(ids.includes(id));
        assert.equal(id, setupMatchWaves(gd, createRng(seed)).stageId);
        seen.add(id);
      }
      assert.ok(seen.size >= 8, `${version.id}/${modeId}: ${seen.size} maps`);
    }
  }
});

test('both origins contain complete, parseable official scenes and their texture dependencies', () => {
  for (const camp of ['game', 'game_ops']) {
    const manifest = json(`${camp}/data/local-assets.json`);
    for (const id of json(`${camp}/data/config.json`).mapRotation) {
      const group = manifest.groups[`scene/${id}`];
      assert.ok(group?.scene && group?.bin, id);
      const scene = json(`${camp}/public${group.scene.path}`);
      const bytes = fs.readFileSync(new URL(`${camp}/public${group.bin.path}`, root));
      assert.equal(bytes.length, scene.binBytes);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      assert.ok(parseSceneChunks(scene, buf)?.length > 0, id);
    }
    for (const entries of Object.values(manifest.groups)) for (const entry of Object.values(entries)) {
      if (entry.path) assert.ok(fs.existsSync(new URL(`${camp}/public${entry.path}`, root)), entry.path);
    }
  }
});

test('watching an invasion preparation uses the same camera from either camp', () => {
  for (const [width, height] of [[2556, 1408], [1440, 900], [740, 440]]) {
    const viewport = { width, height };
    const own = invasionPrepCamera(viewport);
    const other = invasionCameraFromAlliance(viewport, INVASION_PREP_RECT);
    for (const [x, y] of [[4, 11], [7, 15], [15, 17]]) {
      assert.deepEqual(other.project(x, y, 0), own.project(x, y, 0));
    }
  }
});

test('monster spectating resolves official terrain while preserving its independent prep grid', () => {
  const monster = json('game/data/versions/act3autochess-v3_1/stages.json');
  const operator = json('game_ops/data/versions/act3autochess-v3_1/stages.json');
  for (const id of json('game/data/config.json').mapRotation) {
    const arena = monster[`arena_${id}`];
    assert.equal(arena.sceneId, id);
    assert.deepEqual(arena.rows, operator[id].rows);
    assert.deepEqual(arena.devices, operator[id].devices);
    assert.notDeepEqual(monster[id].rows, arena.rows);
    assert.equal(monster[id].sceneId, null);
  }
});

test('battle entry keeps the official opponent arena; prep scouting keeps the prep grid', () => {
  for (const version of VERSIONS) {
    const monster = json(`game/data/${version.dir}stages.json`);
    const operator = json(`game_ops/data/${version.dir}stages.json`);
    const monsterData = { stage: (id) => monster[id] };
    const operatorData = { stage: (id) => operator[id] };
    for (const id of json('game/data/config.json').mapRotation) {
      const meta = { stageId: id, kind: 'normal' };
      // MatchScreen and enterBattle must resolve the same object in either order.
      const chosen = fieldStage(monsterData, meta);
      assert.equal(chosen, monster[`arena_${id}`]);
      assert.equal(fieldStage(monsterData, { ...meta }), chosen);
      assert.equal(chosen.sceneId, id);
      assert.equal(fieldStage(monsterData, { ...meta, prep: true }), monster[id]);
      assert.equal(fieldStage(monsterData, { stageId: chosen.id }), chosen);
      assert.equal(fieldStage(operatorData, meta), operator[id]);
    }
  }
  assert.equal(fieldStage({}, { stageId: 'unknown' }), null);
  assert.equal(fieldStage({ stage: () => undefined }, null), null);
});

test('a solo match and its AI keep one terrain layout over successive rounds', () => {
  const previous = process.env.OPS_MODE;
  process.env.OPS_MODE = '1';
  const h = makeMatch({ mode: 'solo', seed: 673 });
  const ai = new SoloOpponent(h.m, 'ops');
  try {
    const id = h.m.stageId;
    for (const round of [1, 2, 7, 14]) {
      const m = ai.prepare(round);
      assert.equal(h.m.stageId, id);
      assert.equal(m.stageId, id);
      const battle = ai.operatorBattle(round, { spawns: [] });
      assert.equal(battle.fieldMeta().stageId, id);
      assert.notEqual(battle.constructor.name, 'DeadBattle');
      assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
    }
  } finally {
    ai.dispose(); h.m.dispose();
    if (previous === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = previous;
  }
});

test('AI defenders and monster waves simulate successfully on every official terrain', (t) => {
  const previous = process.env.OPS_MODE;
  t.after(() => {
    if (previous === undefined) delete process.env.OPS_MODE;
    else process.env.OPS_MODE = previous;
  });
  process.env.OPS_MODE = '1';
  for (const id of json('game/data/config.json').mapRotation) {
    const h = makeMatch({ mode: 'solo', seed: 673 });
    h.m.stageId = id;
    h.m.stage = h.m.gd.stage(id);
    const ai = new SoloOpponent(h.m, 'ops');
    try {
      const battle = ai.operatorBattle(1, { spawns: [
        { enemyKey: 'enemy_1422_lrsldr', time: 1, preview: { gate: 'upper' } },
        { enemyKey: 'enemy_1422_lrsldr', time: 1, preview: { gate: 'lower' } },
      ] });
      assert.notEqual(battle.constructor.name, 'DeadBattle', id);
      for (let tick = 0; tick < 5000 && !battle.finished; tick++) battle.step();
      assert.ok(battle.finished, id);
      assert.equal(battle.result().total, 2, `${id}: both gates spawn real enemies`);
      assert.equal(battle.result().resolved, 2, `${id}: both routes complete`);
      assert.ok(battle.units.some((u) => u.side === 'ally' && u.deployed), id);
      assert.equal(ai.match.errorCount, 0, `${id}: ${JSON.stringify(ai.match.errors)}`);
      assert.equal(battle.result().errors || 0, 0, id);
    } finally { ai.dispose(); h.m.dispose(); }
  }
});
