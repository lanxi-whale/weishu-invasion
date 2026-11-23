import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { COLORS } from '../../public/js/render/style.js';

const executablePath = process.env.CHROME_PATH;
const enabled = process.env.RENDER_E2E === '1' && executablePath && existsSync(executablePath);

test('4v4 spectator keeps the watched field’s models and viewer-relative HP colors when switching fields', {
  skip: !enabled && 'set RENDER_E2E=1 and CHROME_PATH', timeout: 90_000,
}, async () => {
  const { default: puppeteer } = await import('puppeteer-core');
  const { startServer } = await import('../../server/index.js');
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true,
      args: ['--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/dev/render-demo.html?scene=prep&board=2d&panel=0`);
    await page.waitForFunction(() => window.__demo?.ready || window.__demo?.error);
    assert.equal(await page.evaluate(() => window.__demo.error || null), null);

    for (const field of [
      { fieldId: 'n:first', kind: 'normal', spine: 'char_332_archet', hpViewerCamp: 'monster' },
      { fieldId: 'n:second', kind: 'normal', spine: 'char_185_frncat', hpViewerCamp: 'monster' },
      { fieldId: 'unite', kind: 'unite', spine: 'char_332_archet', hpViewerCamp: 'ops' },
    ]) {
      await page.evaluate(({ fieldId, kind, spine, hpViewerCamp }) => {
        const { view, scene } = window.__demo;
        view.enterBattle({ fieldId, kind, hpViewerCamp, stageId: scene.stageId, rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, units: [
          { id: 1, side: 'ally', kind: 'op', defId: 'operator-slot', spine, x: 3, y: 10, maxHp: 100 },
          { id: 2, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime', spine: 'enemy_1007_slime', x: 6, y: 10, maxHp: 100 },
        ] });
        view.pushSnapshot({ fieldId, gt: 15, units: [[1, 3, 10, 100, 100, 0, 0, 0, 0], [2, 6, 10, 100, 100, 0, 0, 0, 0]] });
      }, field);
      await page.waitForFunction(() => window.__demo.view.debug.views.has(1));
      const unit = await page.evaluate(() => {
        const { views } = window.__demo.view.debug;
        return [views.get(1)?.info.side, views.get(1)?.info.spine, !!views.get(1)?._unknown, views.get(2)?.info.side];
      });
      assert.deepEqual(unit, ['ally', field.spine, false, 'enemy'], field.fieldId);
      const colors = await page.evaluate(() => {
        const { views } = window.__demo.view.debug;
        return [views.get(1)?.hpFill?.tint, views.get(2)?.hpFill?.tint];
      });
      const expectedColors = field.hpViewerCamp === 'monster' ? [COLORS.hpEnemy, COLORS.hpAlly] : [COLORS.hpAlly, COLORS.hpEnemy];
      assert.deepEqual(colors, expectedColors, field.fieldId);
      await page.waitForFunction(() => window.__demo.view.debug.views.get(1)?.spineReady);
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
