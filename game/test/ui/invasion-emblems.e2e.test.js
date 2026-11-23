import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('the invasion HUD uses pale emblems and dims inactive bonds', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 45000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`${server.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`);
    await page.waitForFunction(() => !!globalThis.__MOCK__);
    await page.addStyleTag({ url: `${server.url}/css/invasion-theme.css` });
    await page.evaluate(async () => {
      document.documentElement.dataset.camp = 'monster';
      const { data } = await import('/js/data.js');
      await data.load('local');
      const { store } = globalThis.__MOCK__;
      const match = store.get().match;
      store.set({ match: { ...match, private: { ...match.private, bonds: [
        { bondId: 'mon_main_infection', count: 4, tier: 1, active: true },
        { bondId: 'mon_sub_invisible', count: 1, tier: 0, active: false },
        { bondId: 'mon_main_court', count: 1, tier: 0, active: false },
      ] } } });
    });
    await page.waitForFunction(() => {
      const icons = [...document.querySelectorAll('.bstrip .bond__icon')];
      return icons.length === 3 && icons.every((icon) => icon.naturalWidth > 0);
    });
    const icons = await page.$$eval('.bstrip .bond__icon', (images) => Object.fromEntries(images.map((image) => {
      const style = getComputedStyle(image);
      return [image.closest('.bslot').dataset.bond, { src: image.src, filter: style.filter, opacity: Number(style.opacity) }];
    })));
    assert.match(new URL(icons.mon_main_infection.src).pathname, /\/mon_main_infection-[a-f0-9]{12}\.svg$/);
    assert.match(new URL(icons.mon_main_court.src).pathname, /\/mon_main_court-3041bcd66520\.svg$/);
    assert.equal(icons.mon_main_infection.filter, icons.mon_main_court.filter);
    assert.equal(icons.mon_main_infection.opacity, 1);
    assert.equal(icons.mon_sub_invisible.filter, icons.mon_main_court.filter);
    assert.ok(icons.mon_sub_invisible.opacity < 0.6);
    assert.ok(icons.mon_main_court.opacity < 0.6);

    await page.click('.bstrip [data-bond="mon_main_infection"] .bond');
    await page.waitForFunction(() => document.querySelector('.bpop__disc img')?.naturalWidth > 0);
    const popup = await page.$eval('.bpop__disc img', (image) => ({ url: image.src, filter: getComputedStyle(image).filter }));
    assert.deepEqual(popup, { url: icons.mon_main_infection.src, filter: 'none' });
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
});
