import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../game/server/data.js';
import { getVersionData as getOpsData } from '../game_ops/server/data.js';
import { GameData } from '../game/server/match/gamedata.js';
import { computeBonds } from '../game/server/match/bondsMeta.js';
import { createDataStore } from '../game/public/js/data.js';
import { createDataStore as createOpsStore } from '../game_ops/public/js/data.js';
import * as invasionMatchInfo from '../game/public/js/ui/matchInfo.js';
import * as allianceMatchInfo from '../game_ops/public/js/ui/matchInfo.js';
import { RegulationBriefing as InvasionBriefing } from '../game/public/js/ui/regulationBriefing.js';
import { RegulationBriefing as AllianceBriefing } from '../game_ops/public/js/ui/regulationBriefing.js';
import { makeMatch } from '../game/test/match/harness.js';

const { matchInfoModel, MatchBondGroups, MatchBondRow } = invasionMatchInfo;
const versions = [undefined, 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1', 'act3autochess@V3_1'];
const ids = (records) => records.map(b => b.bondId).sort();
const storeOf = (factory, raw) => factory({ fetch: async (url) => ({
  ok: true, json: async () => raw[url.split('/').pop().replace('.json', '')],
}) });

test('monster browser covenant lists agree with server eligibility in every version', async () => {
  for (const factory of [createDataStore, createOpsStore]) {
    for (const version of versions) {
      const raw = getVersionData(version);
      const store = storeOf(factory, raw);
      await store.loadAll('bonds', 'config');
      for (const mode of Object.keys(raw.config.modes)) {
        assert.deepEqual(ids(store.list('bonds')), [...new GameData(raw, mode).bondIds].sort(), `${version} ${mode}`);
      }
      assert.ok(store.list('bonds').some(b => b.bondId.startsWith('mon_minor_')));
      assert.ok(store.list('bonds').some(b => b.bondId.startsWith('mon_sub_')));
    }
  }
});

test('either star of the Sankta Eye supplies the seventh distinct drone on the board', () => {
  const drone = 'mon_main_drone';
  const eye = 'chess_mon_enemy_10084_hlegle';
  for (const version of versions) {
    const gd = new GameData(getVersionData(version), 'mode_multi_normal');
    const otherDrones = gd.visibleChess.filter(id => id !== eye && gd.chess(id).bonds.includes(drone));
    assert.equal(otherDrones.length, 6, version);
    assert.match(gd.bond(drone).desc, /池内 7 只/);
    for (const form of [eye, eye + '_b']) {
      const card = gd.chess(form);
      assert.ok(card.bonds.includes('mon_minor_sankta') && card.bonds.includes('mon_sub_fly'), form);
      const board = new Map([...otherDrones, form].map((id, i) => [String(i), { id, kind: 'chess' }]));
      const result = computeBonds(gd, { board, hand: [], layers: {} });
      assert.equal(result[drone].count, 7, form);
      assert.equal(result[drone].tier, 2, form);
    }
  }
});

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}

test('invasion minor and add-on covenants have separate headings in the briefing and draft dialog', async () => {
  const raw = getVersionData('act3autochess@V3_1');
  const pub = { modeId: 'mode_multi_normal', bondDraw: 'regulation', drawnDisabledBonds: ['mon_minor_snow'] };
  const clients = [
    [createDataStore, invasionMatchInfo, InvasionBriefing],
    [createOpsStore, allianceMatchInfo, AllianceBriefing],
  ];
  for (const [createStore, ui, Briefing] of clients) {
    const store = storeOf(createStore, raw);
    await store.loadAll('bonds', 'config');
    const bonds = store.list('bonds');
    const minor = ids(bonds.filter(bond => bond.bondId.startsWith('mon_minor_')));
    const addon = ids(bonds.filter(bond => bond.bondId.startsWith('mon_sub_')));
    assert.deepEqual([minor.length, addon.length], [12, 9]);

    const info = ui.matchInfoModel(pub, { bonds, mode: raw.config.modes[pub.modeId] });
    assert.equal(info.stateOf('mon_minor_snow'), 'drawn');
    const briefing = Briefing({ pub, gd: { config: raw.config }, info, players: [] });
    const draft = ui.MatchInfo({ model: info });
    for (const tree of [briefing, draft]) {
      const rows = [...walk(tree)].filter(node => node.type === ui.MatchBondRow && node.props.title !== '核心盟约');
      assert.deepEqual(rows.map(({ props }) => [props.title, ids(props.bonds)]), [
        ['小盟约', minor],
        ['附加盟约', addon],
      ]);
    }
  }
});

test('real solo briefing has only monster groups and retains five cores after choosing', async () => {
  const raw = getVersionData('act3autochess@V3_1');
  const store = storeOf(createDataStore, raw);
  await store.loadAll('bonds', 'config', 'chess');
  for (const picked of [0, 1]) {
    const h = makeMatch({ mode: 'solo', modeId: 'mode_single_6', data: raw });
    try {
      h.start();
      const model = () => matchInfoModel(h.m.publicView(), {
        bonds: store.list('bonds'), chess: id => store.lookup('chess', id), mode: h.m.gd.mode,
      });
      const before = model();
      assert.ok(before.bonds.length > 0);
      assert.ok(before.bonds.every(b => b.bondId.startsWith('mon_')));
      assert.deepEqual(before.choice.groups.map(g => g.length), [5, 5]);
      const tree = MatchBondGroups({ model: before, panels: true, onPick() {} });
      const rows = [...walk(tree)].filter(v => v.type === MatchBondRow);
      assert.deepEqual(rows.slice(0, 2).map(v => v.props.bonds.length), [5, 5]);
      assert.ok(rows.flatMap(v => v.props.bonds).every(b => b.bondId.startsWith('mon_')),
        'rows beneath the groups may include excluded monster cores, never operator covenants');
      assert.equal(h.m.pickBondGroup(h.m.order[0], picked, h.m.setupRevision).ok, true);
      const after = model();
      assert.equal(after.core.filter(b => !after.stateOf(b.bondId)).length, 5);
      assert.ok([...after.core, ...after.minor, ...after.addon].every(b => b.bondId.startsWith('mon_')));
    } finally { h.m.dispose(); }
  }
});

test('operator covenants and record lookup survive config loading and content switching', async () => {
  for (const factory of [createDataStore, createOpsStore]) {
    const monster = getVersionData('act3autochess@V3_1');
    const operator = getOpsData('act3autochess@V3_1');
    const store = storeOf(factory, monster);
    await store.load('bonds');
    assert.deepEqual(ids(store.list('bonds')), ids(Object.values(monster.bonds)));
    await store.load('config');
    assert.ok(store.list('bonds').every(b => b.bondId.startsWith('mon_')));
    const opBond = Object.values(monster.bonds).find(b => !b.bondId.startsWith('mon_'));
    assert.ok(opBond, 'official records coexist with monster covenants in installed resources');
    assert.deepEqual(store.lookup('bonds', opBond.bondId), opBond, 'opponent details still resolve by id');
    assert.equal(store.getRaw('bonds'), monster.bonds);
    store.setContent({ id: 'operator', values: { config: operator.config, bonds: operator.bonds } });
    assert.deepEqual(ids(store.list('bonds')), ids(Object.values(operator.bonds)));
    store.setContent(null);
    assert.ok(store.list('bonds').every(b => b.bondId.startsWith('mon_')));
  }
});
