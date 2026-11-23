// Run with RENDER_E2E=1 and CHROME_PATH set to a Chromium browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const executablePath = process.env.CHROME_PATH;
const model = 'char_017_huang';
const front = new URL('../../public/assets/spine/op/' + model + '/front/' + model + '.skel', import.meta.url);
const enabled = process.env.RENDER_E2E === '1' && executablePath && existsSync(executablePath) && existsSync(front);

test('Blaze draws both eyes without dark seams from the face atlas', {
  skip: !enabled && 'set RENDER_E2E=1 and CHROME_PATH and install the Blaze model', timeout: 60_000,
}, async (t) => {
  const { startServer } = await import('../../server/index.js');
  const { default: puppeteer } = await import('puppeteer-core');
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true,
      args: ['--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.port + '/dev/render-demo.html?scene=prep&panel=0&fx=off&paused=1');
    await page.waitForFunction(() => window.__demo?.ready || window.__demo?.error);
    assert.equal(await page.evaluate(() => window.__demo.error || null), null);

    const result = await page.evaluate(async (id) => {
      const { app } = window.__demo.view.debug;
      app.stop();
      const { assets, loadSpineData } = await import('/js/assets.js');
      const { SpineActor } = await import('/js/render/spine.js');
      const entry = assets.spineEntry(id);
      const actor = new SpineActor(await loadSpineData(entry), entry);
      actor.update(0);

      // Frame the face at 2× in the first Idle pose, with the head as the anchor for the pixel samples.
      const head = actor.spine.skeleton.findSlot('F_Head').currentSprite.getBounds();
      const width = 225, height = 160;
      actor.spine.position.set(width / 2 - 18 - 2 * (head.x + head.width / 2), -2 * (head.y + head.height / 2));
      actor.spine.scale.set(2);
      const rt = PIXI.RenderTexture.create({ width, height });
      app.renderer.render(actor.spine, { renderTexture: rt, clear: true });
      const pixels = app.renderer.extract.pixels(rt);
      const rgb = (x, y) => Array.from(pixels.slice(4 * (y * width + x), 4 * (y * width + x) + 3));
      const seam = [[133, 66], [148, 104]].map(([x, y]) =>
        [-1, 0, 1].reduce((sum, dx) => sum + rgb(x + dx, y)[0], 0) / 3);
      const eyes = [[56, 53], [170, 66]].map(([x, y]) => rgb(x, y));
      actor.destroy();
      rt.destroy(true);
      return { seam, eyes };
    }, model);

    t.diagnostic(JSON.stringify(result));
    assert.ok(result.seam.every(red => red > 235), 'the skin-colored eye mesh edges should blend into the face');
    assert.ok(result.eyes.every(([red, green, blue]) => green - red > 40 && blue - red > 40), 'both irises remain cyan');
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
});
