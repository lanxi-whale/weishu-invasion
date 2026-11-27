import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { startServer } from '../../server/index.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { spawnMapChar } from '../../server/sim/content/tokens.js';
import { getVersionData } from '../../server/data.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource } from '../../server/sim/simdata.js';
import { snapFrame } from '../../server/match/fields.js';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SP_E2E === '1' && chrome && existsSync(chrome);

test('user Given a real battle with strategy medics When clicking units and closing details Then attack tiles follow selection',
  { skip: !enabled && 'Set SP_E2E=1 and CHROME_PATH', timeout: 60000 }, async () => {
    const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    try {
      for (const medicId of ['char_613_acmedc', 'char_605_cmedic']) {
        const h = makeBattle({ stageId: 'act2autochess_m01', units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 4 }], autoFinish: false });
        h.step();
        assert.ok(spawnMapChar(h.b, h.b.players[0].playerId, medicId));
        h.step();
        const field = h.b.fieldMeta();
        const snapshot = h.b.snapshot();
        assert.equal(field.units.length, 2);
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.port}/dev/game-mock.html?render=fallback&shot=1&phase=PREP`);
        await page.waitForSelector('.ff-piece');
        await page.evaluate(async ({ field, snapshot }) => {
          const { store } = await import('/js/store.js');
          const { net } = await import('/js/net.js');
          const pub = store.get().match.public;
          store.patch('match', { public: { ...pub, phase: 'COMBAT', fields: [{ fieldId: field.fieldId, players: [pub.players[0].playerId] }] }, field });
          // The local runner emits the snapshot synchronously, before the screen's field-entry effect.
          net._emit('b.snap', snapshot);
        }, { field, snapshot });
        await page.waitForSelector('.ff-unit');
        for (let i = 0; i < field.units.length; i++) {
          const units = await page.$$('.ff-unit');
          await units[i].click();
          await page.waitForSelector('.dpanel');
          await page.waitForSelector('.ff-tile.is-range');
          const lit = await page.$$eval('.ff-tile.is-range', (els) => els.map((e) => [Number(e.dataset.row), Number(e.dataset.col)]));
          const u = field.units[i];
          if (u.defId === medicId) {
            assert.ok(lit.some(([r, c]) => r === 10 && c === 5), 'medic reaches three columns right from the stage tile');
            assert.ok(!lit.some(([, c]) => c === 6), 'inactive skill does not extend the base range');
          }
          // A new wire snapshot must refresh the open overlay, not just the unit sprite.
          await page.evaluate(async ({ snapshot, id }) => {
            const { net } = await import('/js/net.js');
            net._emit('b.snap', { ...snapshot, units: snapshot.units.map((v) => v[0] === id ? [v[0], v[1] + 1, ...v.slice(2)] : v) });
          }, { snapshot, id: u.id });
          await page.waitForFunction((before) => {
            const now = [...document.querySelectorAll('.ff-tile.is-range')].map((e) => [Number(e.dataset.row), Number(e.dataset.col)]);
            return now.length === before.length && now.every(([r, c]) => before.some(([br, bc]) => br === r && bc + 1 === c));
          }, {}, lit);
          await page.evaluate(async () => {
            const { store } = await import('/js/store.js');
            store.patch('match', { public: { ...store.get().match.public, phase: 'SETTLE' } });
            // Allow Preact's after-paint phase effects to run before asserting retained UI.
            await new Promise((resolve) => setTimeout(resolve, 250));
          });
          assert.ok(await page.$('.dpanel'), 'same-field settlement keeps the inspected card');
          assert.ok(await page.$('.ff-tile.is-range'), 'same-field settlement keeps its range');
          await page.click('.dpanel__close');
          await page.waitForFunction(() => !document.querySelector('.ff-tile.is-range'));
          await page.evaluate(async (snapshot) => {
            const { net } = await import('/js/net.js');
            net._emit('b.snap', snapshot);
          }, snapshot);
        }
        await (await page.$$('.ff-unit'))[0].click();
        await page.waitForSelector('.ff-tile.is-range');
        await page.evaluate(async ({ field, snapshot }) => {
          const { store } = await import('/js/store.js');
          const { net } = await import('/js/net.js');
          const fieldId = `${field.fieldId}:next`;
          store.patch('match', { field: { ...field, fieldId } });
          net._emit('b.snap', { ...snapshot, fieldId });
        }, { field, snapshot });
        await page.waitForFunction(() => !document.querySelector('.dpanel') && !document.querySelector('.ff-tile.is-range'));
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
      await server.close();
    }
  });

test('a server-run field updates open unit details when active originium takes effect',
  { skip: !enabled && 'Set SP_E2E=1 and CHROME_PATH', timeout: 60000 }, async () => {
    const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    try {
      const battle = new Battle({
        seed: 1, kind: 'normal', stageId: 'act3autochess_m04', fieldId: 'n:opponent', autoFinish: false,
        timeLimit: 30, content: 'full', modeId: 'mode_single_6', round: 1,
        data: new DataSource(getVersionData('act3autochess@V3_1')),
        players: [{ playerId: 'opponent', units: [{ uid: 5, chessId: 'chess_char_1_01_a', row: 11, col: 7 }] }],
      });
      battle.start();
      const unit = battle.allyUnits.find((u) => u.uid === 5);
      const field = battle.fieldMeta();
      const frame = () => snapFrame(field.fieldId, battle.snapshot({ inspect: true }));
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(server.url + '/dev/game-mock.html?render=fallback&shot=1&phase=PREP');
      await page.waitForSelector('.ff-piece');
      await page.evaluate(async ({ field, snapshot }) => {
        const { store } = await import('/js/store.js');
        const { net } = await import('/js/net.js');
        const pub = store.get().match.public;
        store.patch('match', { public: { ...pub, phase: 'COMBAT', fields: [{ fieldId: field.fieldId, players: ['opponent'] }] }, field });
        net._emit('b.snap', snapshot);
      }, { field, snapshot: frame() });
      await page.waitForSelector('.ff-unit');
      await (await page.$$('.ff-unit'))[0].click();
      await page.waitForSelector('.dpanel [data-live="battle"]');
      assert.equal(await page.$('.dpanel [data-terrain="infection"]'), null);
      const push = () => page.evaluate(async (snapshot) => {
        const { net } = await import('/js/net.js');
        net._emit('b.snap', snapshot);
      }, frame());
      assert.ok(battle.relocate(unit, 11, 6));
      while (battle.time < 1.2) battle.step();
      await push();
      await page.waitForFunction(({ hp, atk, interval }) => {
        const panel = document.querySelector('.dpanel');
        const stats = [...panel.querySelectorAll('.dstat__v')].map((e) => e.textContent);
        return panel.querySelector('[data-terrain="infection"]')?.textContent.includes('300s')
          && panel.querySelector('.dhp').textContent.includes(hp)
          && stats.includes(atk) && stats.includes(interval);
      }, { timeout: 5000 }, { hp: Math.round(unit.hp).toLocaleString('zh-CN'), atk: String(Math.round(unit.s.atk)), interval: unit.s.interval.toFixed(2) + 's' });
      assert.ok(battle.relocate(unit, 11, 7));
      while (battle.time < 4.3) battle.step();
      await push();
      await page.waitForFunction(() => document.querySelector('.dpanel [data-terrain="infection"]')?.textContent.includes('297s'));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  });
