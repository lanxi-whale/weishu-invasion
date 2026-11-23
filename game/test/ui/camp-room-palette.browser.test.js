import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { officialUiProperties } from '../../public/js/ui/officialUi.js';
import { invasionManifest } from '../../public/js/ui/campTheme.js';

const executablePath = process.env.CHROME_PATH;
const enabled = process.env.RENDER_E2E === '1' && executablePath && existsSync(executablePath);

test('both 4v4 clients share the lobby palette and apply camp styling to rooms and battles', {
  skip: !enabled && 'set RENDER_E2E=1 and CHROME_PATH', timeout: 30_000,
}, async () => {
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run'] });
  try {
    const page = await browser.newPage();
    const camps = ['ops', 'monster'];
    const bondStates = ['inactive', 'active', 'disabled'];
    await page.setContent(`<main class="rs rs--4v4" data-season="act3autochess">
      ${camps.map(camp => `<section class="rs-camp rs-camp--${camp}">
        <header class="rs-camp__heading"><h2>${camp}</h2><span>1 / 4</span></header>
        <div class="rs-camp__roster">
          <article class="seat seat--empty rseat rseat--empty">
            <header class="rseat__strip">P1</header>
            <div class="rseat__art">
              <button class="rseat__invite"><span class="rseat__plus"></span>Invite</button>
              <button class="btn btn--secondary rseat__add"><span class="btn__label">Add AI</span></button>
            </div>
          </article>
          <article class="seat rseat is-bot is-lit is-ready">
            <span class="rseat__clip"></span>
            <header class="rseat__strip">P2</header>
            <div class="seat__art rseat__art">
              <span class="rseat__bot">AI</span>
              <span class="rseat__state seat__state--ready">Ready</span>
            </div>
            <button class="rseat__kick" disabled>Remove AI</button>
            <div class="rseat__plate">Teammate</div>
          </article>
        </div>
      </section>`).join('')}
      <button class="btn btn--primary" id="room-start">Start</button>
      <button class="proto-start rs-go" id="official-room-start">Start</button>
      <section class="ally"><div class="ally__body"><div class="ally__bg"></div>
        <div class="ally-stage"><i class="ally-radar-sweep"></i></div>
        <button class="ally-card ally-card--create"><span class="ally-card__art"></span><span class="ally-card__bar">Create</span></button>
        <div class="ally-card ally-card--join"><span class="ally-card__art"></span><button class="ally-card__bar ally-card__bar--join">Join</button></div>
      </div></section>
      <button class="readybtn readybtn--pf"><i class="pf--ready"><i class="pf__g"></i></i><span class="readybtn__label">Ready</span></button>
      <button class="gtop__iconbtn">Scout</button>
      <button class="settle__next"><img class="settle__btnbg" alt="">Continue</button>
      <div class="gm__bonds gm__bonds--pf">
        ${bondStates.map(state => `<button type="button" data-bond-state="${state}"
            class="bond bond--sm ${state === 'inactive' ? '' : 'is-active'} ${state === 'disabled' ? 'is-disabled' : ''}">
          <span class="bond__disc"><span class="bond__core"><img class="bond__icon" alt=""><span class="bond__glyph">B</span></span></span>
          <span class="bond__name">Bond</span>
        </button>`).join('')}
      </div>
      <div class="shopbar--reg" data-reg-theme="ac_n_initial" style="--reg-refresh:url('/refresh.png');--reg-frozen:url('/freeze.png')">
        <button class="toolbtn toolbtn--amber">Refresh</button><button class="toolbtn toolbtn--ice">Freeze</button>
        <button class="lvcard lvcard--up"><i class="rup__l"></i></button>
      </div>
    </main>
    <div class="screen lobby-screen lobby-hub" data-season="act3autochess">
      <div class="hub-bg"></div>
      <header class="topbar">
        <button class="btn btn--ghost">Back</button>
        <button class="btn btn--secondary lobby-settings">Settings</button>
      </header>
      <main class="hub-stage">
        <button class="hub-tile hub-tile--key">Join with key</button>
        <button class="btn btn--primary hub-plate hub-plate--loadout">Loadout</button>
        <div class="hub-entries">
          <div class="hub-mode-switch"><button aria-pressed="true">Solo</button><button aria-pressed="false">Team</button></div>
          <button class="hub-quick">Quick</button>
          <button class="mode-card hub-entry hub-entry--solo"><span class="hub-entry__name">Start</span></button>
        </div>
      </main>
    </div>`);

    for (const client of ['game', 'game_ops']) {
      const publicPath = new URL(`../../../${client}/public/`, import.meta.url);
      const index = readFileSync(new URL('index.html', publicPath), 'utf8');
      const manifest = JSON.parse(readFileSync(new URL('../data/local-assets.json', publicPath), 'utf8'));
      for (const [, cssPath] of index.matchAll(/href="\/(css\/[^"?]+\.css)"/g)) {
        await page.addStyleTag({ content: readFileSync(new URL(cssPath, publicPath), 'utf8') });
      }
      await page.addStyleTag({ content: '.rs button, .lobby-hub button { transition: none !important; animation: none !important; }' });

      let sharedLobby;
      let alliancePaint;
      for (const viewer of camps) {
        const source = viewer === 'monster' ? invasionManifest(manifest) : manifest;
        const official = officialUiProperties(source, manifest);
        const paints = await page.evaluate((viewerCamp, properties) => {
          document.documentElement.dataset.camp = viewerCamp;
          document.documentElement.setAttribute('data-official-ui', '');
          for (const [property, value] of Object.entries(properties)) document.documentElement.style.setProperty(property, value);
          return Object.fromEntries([...document.querySelectorAll('.rs-camp')].map(panel => {
            const probe = panel.appendChild(document.createElement('span'));
            probe.style.backgroundColor = 'var(--camp-surface)';
            const expected = getComputedStyle(probe).backgroundColor;
            probe.remove();
            const buttons = [...panel.querySelectorAll('button')].map(button => {
              const style = getComputedStyle(button);
              return { fill: style.backgroundColor, texture: style.backgroundImage, edge: style.boxShadow };
            });
            const emptyFrame = getComputedStyle(panel.querySelector('.rseat--empty .rseat__art')).borderImageSource;
            const plus = getComputedStyle(panel.querySelector('.rseat__plus')).backgroundImage;
            const strip = panel.querySelector('.is-lit .rseat__strip');
            const marker = panel.matches('.rs-camp--monster') ? getComputedStyle(strip, '::before').maskImage
              : getComputedStyle(strip).backgroundImage;
            const heading = getComputedStyle(panel.querySelector('.rs-camp__heading'));
            const art = panel.querySelector('.is-lit .rseat__art');
            const palette = {
              panel: getComputedStyle(panel).backgroundImage,
              heading: heading.color,
              clip: getComputedStyle(panel.querySelector('.rseat__clip')).backgroundColor,
              badge: getComputedStyle(panel.querySelector('.rseat__bot')).backgroundColor,
              artFill: getComputedStyle(art).backgroundColor,
              artEdge: getComputedStyle(art).borderColor,
              artGradient: getComputedStyle(art, '::after').backgroundImage,
              plate: getComputedStyle(panel.querySelector('.is-lit .rseat__plate')).borderColor,
            };
            return [panel.className, { expected, buttons, emptyFrame, plus, marker, palette }];
          }));
        }, viewer, official);
        const lobby = await page.$$eval('.lobby-hub, .lobby-hub button, .lobby-hub .hub-entry__name', (nodes) => nodes.map((node) => {
          const style = getComputedStyle(node);
          return [style.color, style.backgroundColor, style.backgroundImage, style.borderColor, style.boxShadow];
        }));
        if (viewer === 'ops') sharedLobby = lobby;
        else assert.deepEqual(lobby, sharedLobby, client + ': main lobby uses the same palette on both origins');
        assert.ok(lobby.at(-2)[2].includes(manifest.groups['ui/outer'].btn_match_normal.path));
        for (const [panel, { expected, buttons, emptyFrame, plus, marker, palette }] of Object.entries(paints)) {
          if (panel.includes('rs-camp--ops')) {
            if (viewer === 'ops') alliancePaint = palette;
            else assert.deepEqual(palette, alliancePaint, `${client}: alliance panel and seats stay green on the invasion origin`);
            assert.match(palette.panel, /rgb\(15, 170, 142\)/);
            assert.equal(palette.badge, 'rgb(33, 197, 166)');
            assert.equal(palette.clip, palette.badge);
            assert.equal(palette.artEdge, palette.badge);
            assert.match(palette.artGradient, /rgb\(23, 107, 93\)/);
          } else {
            assert.match(palette.panel, /rgb\(64, 30, 27\)/);
            assert.equal(palette.badge, 'rgb(171, 55, 51)');
            assert.equal(palette.artEdge, 'rgb(226, 65, 44)');
          }
          for (const button of buttons) {
            if (panel.includes('rs-camp--monster')) {
              assert.match(button.texture, /rgb\(171, 55, 51\)/, `${client} ${viewer} invasion seat control`);
              assert.match(button.edge, /rgb\(202, 181, 170\)/);
            } else {
              assert.equal(button.fill, expected, `${client} ${viewer} alliance seat control`);
              assert.equal(button.texture, 'none');
            }
          }
          assert.match(emptyFrame, /bg_empty\.png/);
          assert.match(plus, /bg_plus\.png/);
          assert.match(marker, /bg_top_ready\.png/);
        }
        const actionImages = await page.$eval('#official-room-start', button => {
          button.disabled = false;
          button.classList.remove('is-ready');
          const active = getComputedStyle(button).backgroundImage;
          button.classList.add('is-ready');
          const ready = getComputedStyle(button).backgroundImage;
          button.disabled = true;
          return { active, ready, disabled: getComputedStyle(button).backgroundImage };
        });
        assert.ok(actionImages.active.includes(source.groups['ui/outer'].btn_match_normal.path));
        assert.match(actionImages.ready, /btn_match_cancel\.png/);
        assert.match(actionImages.disabled, /btn_match_grey\.png/);
        const entryImages = await page.evaluate(() => {
          const barPaint = (bar) => {
            const box = getComputedStyle(bar);
            const face = getComputedStyle(bar, '::before');
            const paint = face.backgroundImage === 'none' ? box : face;
            return { image: paint.backgroundImage, size: paint.backgroundSize, tone: paint.filter, fill: box.backgroundColor, frame: box.boxShadow };
          };
          const createCard = document.querySelector('.ally-card--create');
          return {
            radar: getComputedStyle(document.querySelector('.ally-stage'), '::before').backgroundImage,
            scan: getComputedStyle(document.querySelector('.ally-radar-sweep')).backgroundImage,
            create: getComputedStyle(createCard.querySelector('.ally-card__art')).borderImageSource,
            createArt: getComputedStyle(createCard.querySelector('.ally-card__art'), '::after').backgroundImage,
            createFill: getComputedStyle(createCard).backgroundColor,
            join: getComputedStyle(document.querySelector('.ally-card--join .ally-card__art')).borderImageSource,
            createBar: barPaint(createCard.querySelector('.ally-card__bar')),
            joinBar: barPaint(document.querySelector('.ally-card__bar--join')),
          };
        });
        assert.ok(entryImages.radar.includes(source.groups['ui/outer'].img_center_circle.path));
        assert.ok(entryImages.scan.includes(source.groups['ui/outer'].img_pointer.path));
        assert.match(entryImages.create, /room_create_btn_bg\.png/);
        assert.match(entryImages.createArt, /room_select_create_middleicon\.png/);
        assert.match(entryImages.join, /room_join_btn_bg\.png/);
        assert.match(entryImages.createBar.image, /room_select_create_btn_bg_down\.png/);
        assert.match(entryImages.joinBar.image, /room_select_join_btn_bg_down\.png/);
        for (const bar of [entryImages.createBar, entryImages.joinBar]) {
          const [width, height] = bar.size.split(' ').map(parseFloat);
          assert.ok(width >= 107 && height >= 155, `${client} ${viewer}: the button face fills the label area (${bar.size})`);
          assert.equal(bar.fill, 'rgba(0, 0, 0, 0)');
          assert.equal(bar.frame, 'none');
          if (viewer === 'monster') assert.match(bar.tone, /invasion-tone\.svg#brick/);
          else assert.equal(bar.tone, 'none');
        }
        assert.equal(entryImages.createFill, 'rgba(0, 0, 0, 0)');
        const battle = await page.evaluate(() => ({
          readyFace: getComputedStyle(document.querySelector('.pf--ready')).visibility,
          readyPlateFilter: getComputedStyle(document.querySelector('.pf--ready .pf__g')).filter,
          readyLabel: getComputedStyle(document.querySelector('.readybtn__label')).clipPath,
          scoutPaint: getComputedStyle(document.querySelector('.gtop__iconbtn')).backgroundImage,
          scoutEdge: getComputedStyle(document.querySelector('.gtop__iconbtn')).boxShadow,
          refresh: getComputedStyle(document.querySelector('.toolbtn--amber')).backgroundImage,
          refreshFill: getComputedStyle(document.querySelector('.toolbtn--amber')).backgroundColor,
          freeze: getComputedStyle(document.querySelector('.toolbtn--ice')).backgroundImage,
          upgrade: getComputedStyle(document.querySelector('.lvcard--up')).backgroundImage,
          upgradePlateFilter: getComputedStyle(document.querySelector('.lvcard--up .rup__l')).filter,
          settlePlateFilter: getComputedStyle(document.querySelector('.settle__next .settle__btnbg')).filter,
        }));
        assert.equal(battle.readyFace, 'visible', `${client} ${viewer} ready prefab`);
        assert.equal(battle.readyLabel, 'inset(50%)');
        assert.match(battle.refresh, /refresh\.png/);
        assert.match(battle.freeze, /freeze\.png/);
        assert.equal(battle.upgrade, 'none');
        const bonds = await page.$$eval('[data-bond-state]', buttons => Object.fromEntries(buttons.map(button => {
          const core = getComputedStyle(button.querySelector('.bond__core'));
          return [button.dataset.bondState, {
            disc: core.backgroundImage,
            glow: core.filter,
            iconOpacity: Number(getComputedStyle(button.querySelector('.bond__icon')).opacity),
            glyphOpacity: Number(getComputedStyle(button.querySelector('.bond__glyph')).opacity),
          }];
        })));
        if (viewer === 'monster') {
          assert.ok(bonds.inactive.iconOpacity <= .55, `${client} inactive bond icon is dim`);
          assert.ok(bonds.inactive.glyphOpacity <= .55, `${client} inactive fallback glyph is dim`);
          assert.equal(bonds.active.iconOpacity, 1);
          assert.equal(bonds.active.glyphOpacity, 1);
          assert.notEqual(bonds.active.disc, bonds.inactive.disc);
          assert.match(bonds.active.glow, /drop-shadow/);
          assert.equal(bonds.disabled.iconOpacity, bonds.inactive.iconOpacity);
          assert.equal(bonds.disabled.disc, bonds.inactive.disc);
          assert.match(bonds.disabled.glow, /grayscale/);
          assert.match(await page.$eval('#room-start', button => getComputedStyle(button).backgroundImage), /rgb\(171, 55, 51\)/);
          assert.match(battle.scoutPaint, /rgb\(171, 55, 51\)/);
          assert.match(battle.scoutEdge, /rgb\(202, 181, 170\)/);
          assert.equal(battle.refreshFill, 'rgb(171, 55, 51)');
          assert.match(battle.readyPlateFilter, /invasion-tone\.svg#brick/);
          assert.equal(battle.upgradePlateFilter, battle.readyPlateFilter);
          assert.equal(battle.settlePlateFilter, battle.readyPlateFilter);
        } else {
          assert.doesNotMatch(battle.scoutPaint, /rgb\(171, 55, 51\)/);
          assert.doesNotMatch(battle.readyPlateFilter, /invasion-tone\.svg/);
          assert.equal(bonds.inactive.iconOpacity, 1);
          assert.equal(bonds.inactive.glyphOpacity, 1);
        }
      }

      await page.evaluate(() => document.querySelectorAll('style').forEach(style => style.remove()));
    }
  } finally {
    await browser.close();
  }
});
