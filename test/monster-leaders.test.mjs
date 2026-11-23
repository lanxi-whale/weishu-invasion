import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameData } from '../game/server/match/gamedata.js';
import { createDataStore, data } from '../game/public/js/data.js';
import { BandIcon, PlayerAvatar } from '../game/public/js/ui/gameComponents.js';
import { monsterLeaderFor, POMPEII_BAND_ID } from '../game/shared/monsterLeaders.js';
import { makeMatch, DATA } from '../game/test/match/harness.js';

test('older seasons retain their leader aliases and use the invasion strategy descriptions', async () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  const ids = gd.bandIds();
  assert.ok(ids.length >= 4);
  for (const id of ids) {
    const band = gd.band(id);
    const source = DATA.bands[id];
    assert.ok(monsterLeaderFor(id));
    assert.ok(DATA.assets.enemies[band.leaderKey]?.icon, 'leader identity has a portrait even when excluded from the battle pool');
    assert.match(band.effectId, /^invasion:/);
    assert.deepEqual(band.buffs, []);
    assert.deepEqual(band.skills, []);
    assert.equal(gd.startLp(id), source?.totalHp ?? gd.defaultStartLp);
  }
  assert.equal(gd.band('band_dusk').strategyName, '护茧');
  assert.equal(gd.band(POMPEII_BAND_ID).strategyName, '源石虫增员');
  assert.equal(gd.band(POMPEII_BAND_ID).totalHp, gd.defaultStartLp);
  assert.ok(!gd.bandAllowed('band_nonexistent'));
  const unmapped = Object.keys(DATA.bands).find((id) => !monsterLeaderFor(id));
  assert.equal(gd.bandAllowed(unmapped), false);
  const store = createDataStore({ fetch: async (url) => {
    const name = url.split('/').pop().replace('.json', '');
    return { ok: true, json: async () => DATA[name] };
  } });
  await store.loadAll('bands', 'config', 'enemies');
  for (const id of ids) assert.deepEqual(store.lookup('bands', id), gd.band(id));
  assert.equal(store.lookup('bands', unmapped), null);
  assert.equal(store.getRaw('bands')[ids[0]].name, DATA.bands[ids[0]].name);
  const original = new GameData({ ...DATA, config: { ...DATA.config, monsterOnly: false } }, 'mode_multi_normal');
  assert.equal(original.band(ids[0]).leaderKey, undefined);
});

test('picking a leader records its strategy without adding a deployed unit', () => {
  const h = makeMatch({ mode: 'coop', humans: 2 });
  try {
    h.start();
    for (const ps of h.m.players.values()) h.m.handle(ps.playerId, { t: 'g.infoReady' });
    h.sched.advance(1);
    assert.equal(h.m.phase, 'BAND_DRAFT');
    const ps = h.m.players.get(h.m.draftTurn());
    const id = POMPEII_BAND_ID;
    const before = ps.board.size;
    const response = h.m.handle(ps.playerId, { t: 'g.band', bandId: id });
    assert.ok(!response?.error);
    assert.equal(ps.bandId, id);
    assert.equal(ps.lp, h.m.gd.defaultStartLp);
    assert.equal(ps.board.size, before);
    assert.equal(h.m.gd.band(id).leaderKey, monsterLeaderFor(id).enemyKey);
  } finally { h.m.dispose(); }
});

test('the invasion team panel uses each seat’s drafted leader portrait after reconnect', t => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 3, aiPicksLast: true });
  t.after(() => h.m.dispose());
  data.setContent({ id: 'invasion-test', values: {
    assets: DATA.assets, bands: DATA.bands, config: DATA.config, enemies: DATA.enemies,
  } });
  t.after(() => data.setContent(null));

  const myId = 'p_0';
  const chosen = POMPEII_BAND_ID;
  h.start().toPrep(1, { band: chosen });
  h.m.onDisconnect(myId);
  h.m.onReconnect(myId);
  const { players } = h.lastTo(myId, 'm.public');
  assert.equal(players.length, 4);
  assert.equal(players.find(p => p.playerId === myId).bandId, chosen);
  assert.equal(players.filter(p => p.isBot).length, 3);
  assert.equal(new Set(players.map(p => p.bandId)).size, 4);
  for (const player of players) {
    const draftImage = BandIcon({ bandId: player.bandId }).props.children;
    const avatar = PlayerAvatar({ player, showLeader: true });
    const teamImage = avatar.props.children[0].props.children;
    assert.ok(draftImage.props.src, player.bandId);
    assert.equal(teamImage.props.src, draftImage.props.src, player.playerId);
    assert.equal(teamImage.props.fallback.props.src, DATA.assets.bands[player.bandId] ?? null);
  }

  const panel = readFileSync(new URL('../game/public/js/ui/teamPanel.js', import.meta.url), 'utf8');
  assert.match(panel, /<\$\{PlayerAvatar\} player=\$\{p\} self=\$\{self\} showLeader=\$\{true\}/);

  const player = players[0];
  const standard = PlayerAvatar({ player }).props.children[0].props.children;
  assert.equal(standard.props.src, null);

  const unpicked = PlayerAvatar({ player: { ...player, bandId: null }, showLeader: true }).props.children[0].props.children;
  assert.equal(unpicked.props.src, null);
  assert.equal(unpicked.props.fallback.props.children, player.name[0]);
});
