import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const executablePath = process.env.CHROME_PATH;
const normal = 'enemy_1305_mhslim';
const elite = 'enemy_1305_mhslim_2';
const battleUnits = [
  { id: 81, defId: normal, piece: `chess_mon_${normal}`, kind: 'enemy', side: 'enemy', col: 3, row: 10 },
  { id: 82, defId: elite, piece: `chess_mon_${normal}_b`, kind: 'enemy', side: 'enemy', col: 4, row: 11 },
  { id: 83, defId: 'enemy_9025_aclts', kind: 'token', side: 'ally', col: 6, row: 10 },
  { id: 84, defId: 'enemy_9026_acltm', kind: 'token', side: 'ally', col: 7, row: 11 },
];
const additionalIds = [
  'enemy_9024_acsgnt', 'enemy_9028_acfncb', 'enemy_9030_acpara', 'enemy_9031_acrefd',
  'enemy_9034_acblk', 'enemy_9039_acrefm', 'enemy_9040_accrit',
];
const prepUnits = [...battleUnits.slice(0, 2), ...additionalIds.map((defId, index) => ({
  id: index + 85, piece: `chess_mon_${defId}`, defId, col: index + 2, row: 12,
}))];
const models = new URL('../../public/assets/local/spine/enemy/', import.meta.url);
const hasModels = [...battleUnits.map(spec => spec.defId), ...additionalIds].every(id =>
  existsSync(new URL(`${id}/${id}.skel`, models)));
const enabled = process.env.RENDER_E2E === '1' && executablePath && existsSync(executablePath) && hasModels;
const out = new URL('../e2e/out/', import.meta.url);

test('4v4 loads the installed enemy models in preparation and draws both summoned models in battle and spectating', {
  skip: !enabled && 'set RENDER_E2E=1 and CHROME_PATH and install the local enemy models', timeout: 90_000,
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
    page.on('response', response => {
      if (response.status() >= 400 && response.url().includes('/local/spine/')) errors.push(response.url());
    });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${server.port}/dev/render-demo.html?scene=prep&panel=0&fx=off`);
    await page.waitForFunction(() => window.__demo?.ready || window.__demo?.error);
    assert.equal(await page.evaluate(() => window.__demo.error || null), null);

    const waitForModels = async (specs, prep = false) => {
      await page.waitForFunction((expected, preparing) => {
        const views = [...window.__demo.view.debug.views.values()];
        return expected.every(spec => views.some(view => {
          if (view.info.defId !== (preparing ? spec.piece : spec.defId) || view.fallback.visible) return false;
          const actor = view.actor;
          const path = `/local/spine/enemy/${spec.defId}/${spec.defId}.skel`;
          return actor?.entry.local && actor.entry.skel.endsWith(path) && actor.names.has(actor.entry.anims.idle)
            && actor.spine.getLocalBounds().width > 0;
        }));
      }, { timeout: 20_000 }, specs, prep);
    };

    await page.evaluate(specs => {
      const board = specs.map(spec => ({
        uid: spec.id, id: spec.piece, kind: 'chess', tier: 1, col: spec.col, row: spec.row, dir: 'RIGHT',
        golden: spec.piece.endsWith('_b'),
      }));
      window.__demo.view.setPrep({ hand: [], temp: [], board }, { editable: false });
    }, prepUnits);
    await waitForModels(prepUnits, true);

    for (const camp of ['ops', 'monster']) {
      await page.evaluate((specs, viewer) => {
        const { view } = window.__demo;
        const rect = { r0: 9, r1: 12, c0: 2, c1: 9 };
        const infos = specs.map(spec => ({
          id: spec.id, kind: spec.kind, side: spec.side, defId: spec.defId, spine: spec.defId,
          x: spec.col, y: spec.row, maxHp: 800, dir: 'RIGHT',
        }));
        view.enterBattle({ fieldId: viewer, kind: 'normal', hpViewerCamp: viewer, stageId: 'act3autochess_m01', rect,
          units: infos.filter(info => info.kind === 'enemy') });
        view.setCamera('normal', { rect, fit: true, instant: true });
        view.pushEvents({ fieldId: viewer, gt: 1, ev: infos.filter(info => info.kind === 'token').map(info => ['spawn', info]) });
        view.pushSnapshot({ fieldId: viewer, gt: 1,
          units: specs.map(spec => [spec.id, spec.col, spec.row, 800, 800, 0, 0, 0, 0]) });
      }, battleUnits, camp);
      await waitForModels(battleUnits);
    }
    assert.deepEqual(errors, []);
    mkdirSync(out, { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('4v4-local-battle-models.png', out)) });
  } finally {
    await browser?.close();
    await server.close();
  }
});
