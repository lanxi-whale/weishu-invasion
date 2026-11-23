import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { officialUiProperties, installOfficialUi } from '../game/public/js/ui/officialUi.js';
import { invasionManifest } from '../game/public/js/ui/campTheme.js';
import { createDataStore } from '../game/public/js/data.js';
import { startupThemeId } from '../game/public/js/uiTheme.js';
import { prefabPackUrl, makePack, buildPose } from '../game/public/js/ui/prefab/view.js';
import { layoutPrefab, scriptRef } from '../game/public/js/ui/prefab/layout.js';
import { hudBinds, hudStatus, cornerOffset } from '../game/public/js/ui/prefab/hud.js';
import { assessTheme, themePathsOf } from '../game/shared/uiTheme.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const json = path => JSON.parse(read(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = json('game/data/local-assets.json');
const group = 'themes/ac_n_initial';

test('the 4v4 leak badge follows the watched field and resets when the joint battle starts', async () => {
  for (const camp of ['game', 'game_ops']) {
    const { GateLeakTag, gateLeakCount } = await import(new URL(`${camp}/public/js/ui/hud.js`, root));
    const fields = [
      { fieldId: 'n:first', kind: 'normal', gateLeaks: 2 },
      { fieldId: 'n:second', kind: 'normal', gateLeaks: 0 },
      { fieldId: 'n:third', kind: 'normal', gateLeaks: 7 },
      { fieldId: 'u', kind: 'unite', gateLeaks: 0 },
    ];
    const combat = { duel: true, phase: 'COMBAT', fields };
    assert.equal(gateLeakCount(combat, 'n:first'), 2);
    assert.equal(gateLeakCount(combat, 'n:second'), null);
    assert.equal(gateLeakCount(combat, 'n:third'), 7);
    assert.equal(gateLeakCount(combat, 'n:missing'), null);
    const joint = { ...combat, phase: 'UNITE' };
    assert.equal(gateLeakCount(joint, 'n:first'), null);
    assert.equal(gateLeakCount(joint, 'u'), null);
    fields[3].gateLeaks = 3;
    assert.equal(gateLeakCount(joint, 'u'), 3);
    assert.equal(gateLeakCount({ ...joint, phase: 'SETTLE' }, 'u'), null);
    assert.match(GateLeakTag({ n: 3 }).props['aria-label'], /3$/);
  }
});

test('both camps install identical official UI assets, with no missing files', () => {
  const other = json('game_ops/data/local-assets.json');
  let checked = 0;
  for (const [key, entries] of Object.entries(manifest.groups)) {
    if (!key.startsWith('ui/') && key !== group) continue;
    assert.deepEqual(other.groups[key], entries, key);
    for (const entry of Object.values(entries)) {
      const rel = `public${entry.path}`;
      assert.equal(hash(read(`game/${rel}`)), hash(read(`game_ops/${rel}`)), entry.path);
      checked++;
    }
  }
  assert.ok(checked > 1500, 'actual UI sprites, prefab nodes, fonts and animations were installed');
  assert.ok(Object.keys(officialUiProperties(manifest)).length >= 19);
});

test('the 4v4 room connects its seat and room controls to the official sprite manifest', () => {
  const roomSprites = {
    exit: 'img_return', code: 'bg_room_id', copy: 'btn_bg_duplicate', modes: 'bg_mode',
    empty: 'bg_empty', plate: 'card_empty', plus: 'bg_plus', noinfo: 'noinfo',
    strip: 'bg_top_normal', 'strip-ready': 'bg_top_ready', matte: 'front_matte_normal',
    prepared: 'icon_prepared', cancel: 'btn_match_cancel', host: 'btn_match_host_normal',
  };
  for (const client of ['game', 'game_ops']) {
    const sprites = officialUiProperties(json(`${client}/data/local-assets.json`));
    const css = read(`${client}/public/css/official-ui.css`).toString();
    for (const [slot, sprite] of Object.entries(roomSprites)) {
      const property = `--official-room-${slot}`;
      assert.equal(sprites[property], `url("/assets/local/ui/outer/${sprite}.png")`, `${client} ${slot}`);
      assert.ok(css.includes(`var(${property})`), `${client} ${slot} is used by the room stylesheet`);
    }
    const room = read(`${client}/public/js/screens/room.js`).toString();
    assert.match(room, /room\.campRoom \? ' rs--4v4' : ''/);
    assert.match(room, /data-testid="room-take-seat"/);
    assert.match(room, /data-testid="room-invite-seat"[^\n]*\n\s+onClick=\$\{onInvite\}/);
    assert.match(room, /onInvite=\$\{\(\) => copy\('code'\)\}/);
    assert.match(room, /onSit=\$\{canChooseSeat \? \(\) => sit\(i, camp\) : null\}/);
  }
});

test('the paired 4v4 interface omits the two version shortcuts', () => {
  for (const client of ['game', 'game_ops']) {
    const lobby = read(`${client}/public/js/screens/lobby.js`).toString();
    const room = read(`${client}/public/js/screens/room.js`).toString();
    for (const source of [lobby, room]) assert.match(source, /const paired = !!globalThis\.window\?\.__SP_CAMP__\?\.front/);
    assert.match(lobby, /paired \? null : html`<\$\{VersionSwitch\} \/>`/);
    assert.match(room, /\$\{!paired && versionCtl \? html`[^\n]*data-testid="room-version"/);
    assert.match(room, /data-testid="room-opt-difficulty"/);
    assert.match(room, /label=\$\{t\('开始模拟'\)\}/);
  }
});

test('official shell follows late manifest arrival and cleans up subscriptions', async () => {
  const styles = new Map();
  const attrs = new Set();
  const element = {
    style: { setProperty: (k, v) => styles.set(k, v), removeProperty: k => styles.delete(k) },
    toggleAttribute: (k, on) => on ? attrs.add(k) : attrs.delete(k),
    removeAttribute: k => attrs.delete(k),
  };
  const store = createDataStore({ fetch: async () => ({ ok: true, json: async () => manifest }) });
  const cleanup = installOfficialUi(element, store);
  await store.load('local');
  assert.equal(attrs.has('data-official-ui'), true);
  assert.match(styles.get('--official-confirm'), /\/assets\/local\/ui\/outer\//);
  cleanup();
  assert.equal(styles.size, 0);
  assert.equal(attrs.size, 0);
  assert.deepEqual(officialUiProperties({ groups: { 'ui/outer': {
    img_group_title: { path: '/assets/local/ui/outer/../../bad.png' },
    btn_confirm: { path: '/assets/local/ui/outer/x"bad.png' },
  } } }), {});
});

test('both camps use the original main lobby action asset alongside their own protocol asset', async () => {
  for (const client of ['game', 'game_ops']) {
    const { installOfficialUi: install } = await import(new URL(client + '/public/js/ui/officialUi.js', root).href);
    const styles = new Map();
    const element = {
      style: { setProperty: (k, v) => styles.set(k, v), removeProperty: (k) => styles.delete(k) },
      toggleAttribute() {}, removeAttribute() {},
    };
    const store = createDataStore({ fetch: async () => ({ ok: true, json: async () => manifest }) });
    store.setView('local', invasionManifest);
    const cleanup = install(element, store);
    try {
      await store.load('local');
      assert.match(styles.get('--official-match'), /\/assets\/local\/ui\/invasion\//);
      assert.equal(styles.get('--official-home-match'), 'url("/assets/local/ui/outer/btn_match_normal.png")');
    } finally { cleanup(); }
  }
});

test('alliance entry uses the official room select plates and resolves the invasion radar variants', () => {
  const css = read('game/public/css/official-ui.css').toString();
  const expected = {
    'radar-frame': 'bg_desc_left', 'radar-grid': 'img_desc_grid', 'radar-ring': 'img_center_circle',
    'radar-pointer': 'img_pointer', 'panel': 'room_select_right_bg', 'create-frame': 'room_create_btn_bg',
    'join-frame': 'room_join_btn_bg', 'create-bar': 'room_select_create_btn_bg_down',
    'join-bar': 'room_select_join_btn_bg_down', 'key': 'room_select_join_text_bg',
  };
  const alliance = officialUiProperties(manifest);
  const invasion = officialUiProperties(invasionManifest(manifest));
  for (const [slot, sprite] of Object.entries(expected)) {
    const property = `--official-ally-${slot}`;
    const path = manifest.groups['ui/outer'][sprite].path;
    const invasionPath = manifest.groups['ui/invasion'][`ui/outer/${sprite}`]?.path || path;
    assert.equal(alliance[property], `url("${path}")`);
    assert.equal(invasion[property], `url("${invasionPath}")`);
    assert.ok(css.includes(`var(${property})`));
  }
});

test('installed official terminal is selected at startup and its theme validates', () => {
  assert.equal(startupThemeId('', manifest), 'ac_n_initial');
  assert.equal(startupThemeId('personal', manifest), 'personal');
  assert.equal(startupThemeId('', { groups: {} }), '');
  const entry = manifest.groups[group]['prefabs.json'];
  assert.equal(prefabPackUrl(manifest.groups, 'ac_n_initial'), entry.path);
  const theme = json('game/public/assets/local/themes/ac_n_initial/theme.json');
  const files = [...themePathsOf(theme)].map(path => ({ path, size: statSync(new URL(`game/public/assets/local/themes/ac_n_initial/${path}`, root)).size }));
  const result = assessTheme({ jsonText: JSON.stringify(theme), files, replace: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(Object.keys(theme.colors).length > 10, 'metadata came from the active decoded official table');
});

test('actual default prefab retains round, HP, combat counts and prep-ready layouts', () => {
  const doc = json('game/public/assets/local/themes/ac_n_initial/prefabs.json');
  const pack = makePack(manifest.groups, group, doc);
  const hud = doc.prefabs.group_hud;
  const v = { phase: 'COMBAT', round: '14', lp: 26, pending: 2, hud: { resolved: 3, total: 6 }, miss: null, boss: null };
  const binds = hudBinds(hud, v);
  assert.equal(binds.texts.get(scriptRef(hud, '_roundText')), '14');
  assert.equal(binds.texts.get(scriptRef(hud, '_playerHpText')), '26');
  assert.ok([...binds.texts.values()].includes('3'));
  assert.ok([...binds.texts.values()].includes('6'));
  const names = box => [box.node.name, ...box.children.flatMap(names)];
  for (const phase of ['PREP', 'COMBAT']) {
    const pose = buildPose(pack, hud, { status: [hudStatus(phase, v.hud)], ...binds });
    const { box } = layoutPrefab(hud, { pose });
    assert.ok(box.w > 100 && box.h > 0);
    const visible = names(box);
    assert.ok(visible.includes(phase === 'PREP' ? 'group_rest' : 'group_battle'));
    assert.equal(visible.includes(phase === 'PREP' ? 'group_battle' : 'group_rest'), false);
  }
  const ready = layoutPrefab(doc.prefabs.panel_prep_ready).bounds;
  assert.ok(ready.w > 0 && ready.h > 0);
  assert.equal(cornerOffset(pack).y, '0rem', 'Ready stays at the top edge instead of covering the battlefield');
  assert.match(cornerOffset(pack).x, /^calc\(100% - /, 'right alignment follows the live countdown width, including untimed solo');
  let sprites = 0;
  const checkImages = node => {
    if (node.image?.sprite && !node.image.external) {
      const url = pack.sprite(node.image.sprite, node.image.file);
      assert.ok(url, node.image.sprite);
      assert.ok(existsSync(new URL(`game/public${url}`, root)), url);
      sprites++;
    }
    for (const child of node.children || []) checkImages(child);
  };
  for (const prefab of Object.values(doc.prefabs)) checkImages(prefab);
  assert.ok(sprites > 100);
});
