import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const executablePath = process.env.CHROME_PATH;
const hasFx = existsSync(new URL('../../public/assets/local/fx/index.json', import.meta.url));
const enabled = process.env.RENDER_E2E === '1' && executablePath && existsSync(executablePath) && hasFx;
const out = new URL('../e2e/out/', import.meta.url);

const fields = [
  {
    id: 'n:invasion-view', camp: 'monster', kind: 'normal', stageId: 'act3autochess_m01', op: 'char_290_vigna', defId: 'chess_char_1_05_a', skillIndex: 1, enemy: 'enemy_1021_bslime',
    keys: ['vigna_attack_01_start', 'vigna_attack_01_hit', 'vigna_skill_02_buff_02', 'bslime_die_01_start'],
    ev: [['atk', 1, 2, 'none'], ['dmg', 2, 30, 'phys'], ['skill', 1, 1], ['fx', 'explode', 6, 10, { id: 2, kind: 'deathBoom', r: 1.5 }]],
  },
  {
    id: 'unite', camp: 'ops', kind: 'unite', stageId: 'act1autochess_escaped_multi', op: 'char_1028_texas2', defId: 'chess_char_4_16_a', skillIndex: 2, enemy: 'enemy_1067_snslime',
    keys: ['texas2_skill_03_range', 'texas2_skill_03_hit_02', 'snslime_die_01_start'],
    ev: [['skill', 1, 1], ['fx', 'swordStorm', 5, 10, { id: 1 }], ['fx', 'swordRain', 6, 10, { id: 2 }], ['fx', 'explode', 6, 10, { id: 2, kind: 'deathBoom', r: 1.5 }]],
  },
];

test('official prefab attacks and skills survive a spectator switch without extra rings or old effects', {
  skip: !enabled && 'set RENDER_E2E=1 and CHROME_PATH, with the locally extracted effects installed', timeout: 90_000,
}, async () => {
  const { default: puppeteer } = await import('puppeteer-core');
  const { startServer } = await import('../../server/index.js');
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true,
      args: ['--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.text().startsWith('[render] event failed')) errors.push(message.text()); });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${server.port}/dev/render-demo.html?scene=prep&panel=0`);
    await page.waitForFunction(() => window.__demo?.ready || window.__demo?.error);
    assert.equal(await page.evaluate(() => window.__demo.error || null), null);
    await page.waitForFunction(() => window.__demo.view.debug.ofx.active && window.__demo.view.debug.wiring.index);
    await page.evaluate(() => {
      const { ofx } = window.__demo.view.debug;
      const spawn = ofx.spawn.bind(ofx);
      window.__playedFx = [];
      ofx.spawn = (key, place, opts) => {
        const handle = spawn(key, place, opts);
        if (handle) window.__playedFx.push(key);
        return handle;
      };
    });
    mkdirSync(out, { recursive: true });

    for (const [index, fixture] of fields.entries()) {
      const old = await page.evaluate(({ id, camp, kind, stageId, op, defId, skillIndex, enemy }) => {
        const { view } = window.__demo;
        const rect = { r0: 9, r1: 12, c0: 0, c1: 10 };
        view.enterBattle({ fieldId: id, hpViewerCamp: camp, kind, rect, stageId, units: [
          { id: 1, kind: 'op', side: 'ally', defId, spine: op, x: 5, y: 10, maxHp: 800, dir: 'RIGHT', skillIndex },
          { id: 2, kind: 'enemy', side: 'enemy', defId: enemy, spine: enemy, x: 6, y: 10, maxHp: 800, dir: 'LEFT' },
        ] });
        view.setCamera(kind, { rect, fit: true, instant: true });
        const snap = gt => view.pushSnapshot({ fieldId: id, gt, units: [[1, 5, 10, 800, 800, 0, 0, 0, 0], [2, 6, 10, 800, 800, 0, 0, 0, 0]] });
        snap(1);
        window.__characterFxSnap = snap;
        window.__playedFx.length = 0;
        const { ofx, fx } = view.debug;
        return [ofx.effects.length, ofx.pending.length, fx.parts.length, fx.rings.length];
      }, fixture);
      assert.deepEqual(old, [0, 0, 0, 0], `${fixture.id} clears the previous field`);
      await page.waitForFunction(keys => {
        const { views, ofx } = window.__demo.view.debug;
        return views.size === 2 && keys.every(key => ofx.lib.def(key));
      }, {}, fixture.keys);
      await page.evaluate(({ id, ev }) => {
        const { view } = window.__demo;
        window.__characterFxSnap(1.1);
        view.pushEvents({ fieldId: id, gt: 1.1, ev });
        view.debug.interp.snapToNewest();
      }, fixture);
      await page.waitForFunction(() => window.__demo.view.debug.interp.events.length === 0 && window.__demo.view.debug.ofx.stats().draws > 0);
      const state = await page.evaluate(() => {
        const { fx, ofx } = window.__demo.view.debug;
        return { keys: window.__playedFx, rings: fx.rings.length, stats: ofx.stats() };
      });
      assert.deepEqual(errors, []);
      for (const key of fixture.keys) assert.ok(state.keys.includes(key), `${fixture.id}: missing ${key} (${state.keys.join(', ')}; rings: ${state.rings})`);
      assert.equal(state.rings, 0, `${fixture.id}: no procedural ground rings over these official effects`);
      assert.ok(state.stats.draws > 0 && state.stats.textures > 0);
      await page.screenshot({ path: fileURLToPath(new URL(`vfx-official-spectator-${index + 1}.png`, out)) });
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
